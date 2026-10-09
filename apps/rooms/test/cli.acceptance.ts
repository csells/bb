import { RoomsStore } from "../src/store.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const origin = process.env.ROOMS_TEST_ORIGIN ?? "http://127.0.0.1:38900";
const store = new RoomsStore(
  (process.env.ROOMS_DATA_DIR ?? "/Users/admin/rooms-data") + "/rooms.sqlite",
);
const room = store.createRoom("CLI acceptance", "");
const handle = "cli_" + Date.now();
const password = crypto.randomUUID();
store.register(store.invite(room.id, "owner"), handle, "CLI Human", password);
store.close();
const dir = await mkdtemp(join(tmpdir(), "rooms-cli-"));
try {
  const credentials = join(dir, "login.json"),
    token = join(dir, "session"),
    message = join(dir, "message.txt"),
    policy = join(dir, "policy.json");
  await writeFile(credentials, JSON.stringify({ handle, password }), {
    mode: 0o600,
  });
  await writeFile(message, "A real CLI message");
  await writeFile(policy, JSON.stringify({ paused: true, maxActivations: 7 }));
  const args = [
    new URL("../../cli/dist/index.js", import.meta.url).pathname,
    "rooms",
    "--server",
    origin,
    "--token-file",
    token,
  ];
  const cli = (rest: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [...args, ...rest], { encoding: "utf8" }),
    );
  assert.equal(cli(["login", "--credentials-file", credentials]).saved, true);
  assert.equal((await stat(token)).mode & 0o777, 0o600);
  assert.equal(cli(["list"])[0].id, room.id);
  assert.equal(
    cli(["send", room.id, "--message-file", message]).message.authorName,
    "CLI Human",
  );
  assert.equal(cli(["show", room.id]).messages.length, 1);
  assert.equal(cli(["policy", room.id, "--file", policy]).paused, true);
  assert.equal(cli(["show", room.id]).room.maxActivations, 7);
  const requestId = crypto.randomUUID();
  const send = [
    "send",
    room.id,
    "--message-file",
    message,
    "--intent",
    "notice",
    "--request-id",
    requestId,
  ];
  const first = cli(send);
  const retry = cli(send);
  assert.equal(first.message.id, retry.message.id);
  assert.equal(first.message.intent, "notice");
  assert.equal(cli(["show", room.id]).messages.length, 2);
  console.log(
    "PASS built CLI login, private token file, intent and retry identity, visible policy and persisted show through the running gateway",
  );
} finally {
  await rm(dir, { recursive: true });
}
