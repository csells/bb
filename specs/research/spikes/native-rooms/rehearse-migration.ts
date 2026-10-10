import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConnection,
  migrate,
} from "../../../../packages/db/src/index.ts";

const require = createRequire(
  new URL("../../../../packages/db/package.json", import.meta.url),
);
const Database =
  require("better-sqlite3") as typeof import("better-sqlite3").default;
const [sourceArg, qaRootArg, destinationArg, evidenceArg] =
  process.argv.slice(2);
assert(
  sourceArg && qaRootArg && destinationArg && evidenceArg,
  "Usage: rehearse-migration.ts SOURCE QA_ROOT DESTINATION EVIDENCE",
);
const source = await realpath(sourceArg);
const qaRoot = await realpath(qaRootArg);
const destination = resolve(destinationArg);
assert.equal(
  await realpath(dirname(destination)),
  qaRoot,
  "Copy must be directly inside the owned QA directory",
);
assert.notEqual(source, destination);
assert(destination.endsWith(".sqlite"));
assert(!relative(qaRoot, destination).startsWith(".."));
assert(!isAbsolute(relative(qaRoot, destination)));
await writeFile(destination, "", { flag: "wx", mode: 0o600 });
const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
sourceDb.pragma("query_only = ON");
try {
  await sourceDb.backup(destination);
} finally {
  sourceDb.close();
}
await chmod(destination, 0o600);

const quote = (identifier: string) =>
  '"' + identifier.replaceAll('"', '""') + '"';
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationPath = resolve(
  repository,
  "packages/db/drizzle/0145_native_rooms_bindings.sql",
);
const migrationHash = createHash("sha256")
  .update(await readFile(migrationPath))
  .digest("hex");
const beforeDb = new Database(destination, { readonly: true });
const tables = beforeDb
  .prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rooms_%' ORDER BY name",
  )
  .all() as { name: string }[];
assert(tables.length > 0, "Source has no room tables");
const before = new Map(
  tables.map(({ name }) => {
    const columns = (
      beforeDb.prepare(`PRAGMA table_info(${quote(name)})`).all() as {
        name: string;
      }[]
    ).map((column) => column.name);
    const rows = beforeDb
      .prepare(`SELECT ${columns.map(quote).join(",")} FROM ${quote(name)}`)
      .all();
    const canonical = rows.map((row) => JSON.stringify(row)).sort();
    return [name, { columns, rows: rows.length, digest: digest(canonical) }];
  }),
);
assert.equal(
  beforeDb
    .prepare(
      "SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE hash = ?",
    )
    .get(migrationHash)?.count,
  0,
  "Source already has migration 0145; cannot qualify an upgrade",
);
const identities = {
  rooms: beforeDb
    .prepare("SELECT id, owner_id FROM rooms_rooms ORDER BY id")
    .all(),
  humans: beforeDb
    .prepare("SELECT id, handle FROM rooms_users ORDER BY id")
    .all(),
  memberships: beforeDb
    .prepare(
      "SELECT room_id, user_id, role FROM rooms_members ORDER BY room_id, user_id",
    )
    .all(),
  messages: beforeDb
    .prepare(
      "SELECT id, room_id, seq, author_id FROM rooms_messages ORDER BY seq",
    )
    .all(),
  bindings: beforeDb
    .prepare(
      "SELECT id, room_id, handle, project_id, thread_id FROM rooms_agents ORDER BY id",
    )
    .all(),
};
beforeDb.close();

const db = createConnection(destination);
try {
  migrate(db);
  assert.deepEqual(db.$client.pragma("integrity_check"), [
    { integrity_check: "ok" },
  ]);
  assert.deepEqual(db.$client.pragma("foreign_key_check"), []);
  const tableResults = [...before].map(([name, original]) => {
    const rows = db.$client
      .prepare(
        `SELECT ${original.columns.map(quote).join(",")} FROM ${quote(name)}`,
      )
      .all();
    const currentDigest = digest(rows.map((row) => JSON.stringify(row)).sort());
    assert.equal(rows.length, original.rows, `${name} row count changed`);
    assert.equal(
      currentDigest,
      original.digest,
      `${name} existing values changed`,
    );
    return {
      table: name,
      rows: rows.length,
      beforeSha256: original.digest,
      afterSha256: currentDigest,
      identical: true,
    };
  });
  assert.equal(
    db.$client
      .prepare(
        "SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE hash = ?",
      )
      .get(migrationHash)?.count,
    1,
  );
  for (const [table, columns] of [
    ["rooms_rooms", ["project_id", "default_environment_id", "section_id"]],
    ["rooms_agents", ["environment_id"]],
    ["rooms_activations", ["credential_host_id", "credential_path"]],
  ] as const) {
    for (const column of columns) {
      assert.equal(
        db.$client
          .prepare(
            `SELECT COUNT(*) AS count FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`,
          )
          .get()?.count,
        0,
        `${table}.${column} did not preserve meaningful absence`,
      );
    }
  }
  assert(
    db.$client
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'rooms_agent_thread'",
      )
      .get(),
  );
  const report = {
    verifiedAt: new Date().toISOString(),
    source,
    isolatedCopy: destination,
    migration: { name: "0145_native_rooms_bindings", sha256: migrationHash },
    sqliteIntegrity: "ok",
    foreignKeyViolations: 0,
    runtimeStarted: false,
    dispatcherStarted: false,
    oldColumnsPreserved: true,
    addedColumnsAllNull: true,
    tables: tableResults,
    identities,
  };
  await mkdir(dirname(resolve(evidenceArg)), { recursive: true });
  await writeFile(evidenceArg, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(
    JSON.stringify({
      ok: true,
      roomTables: tableResults.length,
      rows: tableResults.reduce((sum, table) => sum + table.rows, 0),
      evidence: resolve(evidenceArg),
    }) + "\n",
  );
} finally {
  db.$client.close();
}
