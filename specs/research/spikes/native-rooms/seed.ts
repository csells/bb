import { randomBytes } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createNodeBbSdk } from "../../../../packages/sdk/src/node.ts";
import { RoomsStore } from "../../../../apps/rooms/src/store.ts";

const root = process.env.ROOMS_NATIVE_QA;
if (!root)
  throw new Error(
    "ROOMS_NATIVE_QA must name a fresh disposable fixture directory",
  );
await mkdir(root, { recursive: true, mode: 0o700 });
const privateFile = join(root, "fixture-private.json");
try {
  await access(privateFile);
  throw new Error("Fixture already exists; do not overwrite identities");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
const sdk = createNodeBbSdk({ baseUrl: "http://127.0.0.1:38896" });
const host = (await sdk.hosts.list()).find(
  (host) => host.status === "connected",
);
if (!host) throw new Error("The candidate BB execution host must be connected");
const workspace = join(root, "project");
await mkdir(workspace, { mode: 0o700 });
await writeFile(
  join(workspace, "AGENTS.md"),
  "# Native Rooms verification\n\nKeep existing project instructions intact. Work only in this disposable fixture.\n",
);
await writeFile(
  join(workspace, "README.md"),
  "# Native room workspace\n\nA disposable project for browser and provider acceptance.\n",
);
execFileSync("git", ["init", "-b", "main", workspace], { stdio: "ignore" });
execFileSync("git", ["-C", workspace, "add", "."]);
execFileSync(
  "git",
  [
    "-C",
    workspace,
    "-c",
    "user.name=Rooms QA",
    "-c",
    "user.email=rooms-qa@example.invalid",
    "commit",
    "-m",
    "Initialize disposable room fixture",
  ],
  { stdio: "ignore" },
);
const project = await sdk.projects.create({
  name: "Native Rooms QA",
  source: { type: "local_path", hostId: host.id, path: workspace },
});
const data = join(root, "rooms-data");
await mkdir(data, { mode: 0o700 });
const store = new RoomsStore(join(data, "rooms.sqlite"));
try {
  const room = store.createRoom("Native acceptance", "", {
    projectId: project.id,
    defaultEnvironmentId: null,
    sectionId: null,
  });
  const identities = [
    {
      key: "operator",
      handle: "nativeowner",
      name: "Native owner",
      owner: true,
    },
    {
      key: "operator2",
      handle: "nativepartner",
      name: "Native partner",
      owner: false,
    },
    {
      key: "guest",
      handle: "nativemember",
      name: "Native member",
      owner: false,
    },
  ];
  const accounts: Record<
    string,
    { id: string; handle: string; password: string }
  > = {};
  for (const identity of identities) {
    const password = randomBytes(24).toString("base64url");
    const user = store.register(
      store.invite(room.id, identity.owner ? "owner" : "member"),
      identity.handle,
      identity.name,
      password,
    );
    accounts[identity.key] = { id: user.id, handle: user.handle, password };
  }
  await writeFile(join(data, "initialized"), room.id, { mode: 0o600 });
  await writeFile(
    privateFile,
    JSON.stringify(
      {
        url: "http://127.0.0.1:38910",
        ...accounts,
        projectId: project.id,
        roomId: room.id,
        hostId: host.id,
        workspace,
        data,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    join(root, "fixture.json"),
    JSON.stringify(
      {
        projectId: project.id,
        roomId: room.id,
        hostId: host.id,
        workspace,
        data,
        operatorIds: [accounts.operator.id, accounts.operator2.id],
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created one disposable project, one room and three human identities; credentials remain in fixture-private.json",
  );
} finally {
  store.close();
}
