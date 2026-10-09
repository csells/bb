import Database from "better-sqlite3";
import { createNodeBbSdk } from "@bb/sdk";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";

const source = process.env.ROOMS_RECOVERY_DATA;
if (!source || !basename(source).startsWith("rooms-runtime-acceptance-"))
  throw new Error(
    "ROOMS_RECOVERY_DATA must identify a task-owned acceptance directory",
  );
const data = await mkdtemp(join(tmpdir(), "rooms-observation-recovery-"));
const sourceDb = new Database(join(source, "rooms.sqlite"), { readonly: true });
await sourceDb.backup(join(data, "rooms.sqlite"));
sourceDb.close();
const db = new Database(join(data, "rooms.sqlite"), { readonly: true });
const delivery = db
  .prepare("SELECT * FROM rooms_deliveries WHERE state='running'")
  .get();
if (!delivery?.thread_id)
  throw new Error("Fixture has no known running activation");
await writeFile(join(data, "initialized"), delivery.room_id);
const sdk = createNodeBbSdk({
  baseUrl: process.env.ROOMS_BB_URL ?? "http://127.0.0.1:38886",
});
const beforeSeq = (await sdk.threads.timeline({ threadId: delivery.thread_id }))
  .maxSeq;
const logPath = join(data, "gateway.log");
let child;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = {
  data,
  originalDeliveryId: delivery.id,
  threadId: delivery.thread_id,
  checks: [],
};
function check(condition, message) {
  if (!condition) throw new Error(message);
  evidence.checks.push(message);
  console.log("PASS " + message);
}
async function start(bbUrl) {
  const log = createWriteStream(logPath, { flags: "a" });
  await once(log, "open");
  child = spawn(
    process.execPath,
    [resolve(import.meta.dirname, "../dist/server.js")],
    {
      env: {
        ...process.env,
        ROOMS_DATA_DIR: data,
        ROOMS_PORT: "38907",
        ROOMS_PUBLIC_ORIGIN: "http://127.0.0.1:38907",
        ROOMS_BIND_HOST: "127.0.0.1",
        ROOMS_BB_URL: bbUrl,
      },
      stdio: ["ignore", log, log],
    },
  );
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null)
      throw new Error("Gateway stopped: " + (await readFile(logPath, "utf8")));
    try {
      if ((await fetch("http://127.0.0.1:38907/health")).ok) return;
    } catch {}
    await sleep(50);
  }
  throw new Error("Gateway startup timeout");
}
async function stop() {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}
try {
  await start("http://127.0.0.1:1");
  await sleep(1700);
  await stop();
  const failed = db
    .prepare("SELECT state,error FROM rooms_deliveries WHERE id=?")
    .get(delivery.id);
  const log = await readFile(logPath, "utf8");
  check(
    failed.state === "running" && Boolean(failed.error),
    "native connectivity failure retains activation and exposes its observation error",
  );
  check(
    (log.match(/Room execution status could not be confirmed/g) ?? [])
      .length === 1,
    "identical polling failures produce one diagnostic instead of repeating every500ms",
  );
  await start(process.env.ROOMS_BB_URL ?? "http://127.0.0.1:38886");
  const deadline = Date.now() + 15000;
  let recovered;
  while (Date.now() < deadline) {
    recovered = db
      .prepare("SELECT state,error,outcome FROM rooms_deliveries WHERE id=?")
      .get(delivery.id);
    if (recovered.state === "complete") break;
    await sleep(100);
  }
  check(
    recovered.state === "complete" &&
      recovered.error === null &&
      recovered.outcome === "no_reply",
    "actual native terminal receipt clears transient error and settles successful no-public-reply",
  );
  check(
    db
      .prepare(
        "SELECT count(*) AS count FROM rooms_messages WHERE kind='agent'",
      )
      .get().count === 0,
    "private provider output remains unpublished during recovery",
  );
  const afterSeq = (
    await sdk.threads.timeline({ threadId: delivery.thread_id })
  ).maxSeq;
  check(
    beforeSeq === afterSeq,
    "recovery creates no new native execution events",
  );
  evidence.beforeSeq = beforeSeq;
  evidence.afterSeq = afterSeq;
  evidence.recovered = recovered;
} catch (error) {
  evidence.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  await stop();
  db.close();
  await writeFile(
    process.env.ROOMS_RECOVERY_EVIDENCE ?? join(data, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
}
