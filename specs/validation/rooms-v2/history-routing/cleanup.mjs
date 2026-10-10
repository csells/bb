import { createRequire } from "node:module";
import { readFile, writeFile, rm } from "node:fs/promises";
const repo = process.env.ROOMS_TEST_REPO;
const data = process.env.ROOMS_TEST_DATA;
const evidence = process.env.ROOMS_TEST_EVIDENCE;
if (!repo?.startsWith("/Users/admin/") || !data?.startsWith("/Users/admin/") || !evidence) throw new Error("Candidate VM paths required");
const require = createRequire(`${repo}/apps/rooms/package.json`);
const Database = require("better-sqlite3");
const { createNodeBbSdk } = require("@bb/sdk");
const fixture = JSON.parse(await readFile(`${evidence}/fixture.json`, "utf8"));
const result = JSON.parse(await readFile(`${evidence}/result.json`, "utf8"));
if (result.roomId !== fixture.roomId || fixture.roomId === "606b2f3e-4501-45f4-a4fd-83bae65f447a") throw new Error("Invalid cleanup scope");
const db = new Database(`${data}/rooms.sqlite`);
db.pragma("foreign_keys = ON");
const room = db.prepare("SELECT id,name FROM rooms_rooms WHERE id=?").get(fixture.roomId);
if (!room || room.name !== fixture.roomName || !room.name.startsWith("Room-wide routing regression ")) throw new Error("Fixture identity mismatch");
const pending = () => db.prepare("SELECT COUNT(*) AS count FROM rooms_deliveries WHERE room_id=? AND state IN ('queued','dispatching','running','uncertain')").get(room.id).count;
if (pending()) throw new Error("QA work still active; do not delete");
const threads = db.prepare("SELECT DISTINCT thread_id AS id FROM rooms_agents WHERE room_id=? AND thread_id IS NOT NULL").all(room.id);
const sdk = createNodeBbSdk({ baseUrl: "http://127.0.0.1:38886" });
for (const { id } of threads) {
  const thread = await sdk.threads.get({ threadId: id });
  if (!["idle", "error", "stopped"].includes(thread.status)) throw new Error("Native QA thread still active");
  await sdk.threads.archive({ threadId: id });
}
const protectedId = db.prepare("SELECT id FROM rooms_rooms WHERE name=? AND id<>? ORDER BY id LIMIT 1").get("Workshop", room.id)?.id;
if (!protectedId) throw new Error("Protected Workshop missing");
const protectedState = () => JSON.stringify({ room: db.prepare("SELECT * FROM rooms_rooms WHERE id=?").get(protectedId), members: db.prepare("SELECT * FROM rooms_members WHERE room_id=? ORDER BY user_id").all(protectedId), messages: db.prepare("SELECT * FROM rooms_messages WHERE room_id=? ORDER BY seq").all(protectedId) });
const users = db.prepare("SELECT u.id,u.handle FROM rooms_users u JOIN rooms_members m ON m.user_id=u.id WHERE m.room_id=?").all(room.id);
for (const user of users) {
  if (!/^(avery|morgan)_/.test(user.handle) || db.prepare("SELECT COUNT(*) AS count FROM rooms_members WHERE user_id=?").get(user.id).count !== 1) throw new Error("Unexpected QA user scope");
}
db.transaction(() => {
  if (pending()) throw new Error("QA work became active");
  const before = protectedState();
  db.prepare("DELETE FROM rooms_chunks WHERE message_id IN (SELECT id FROM rooms_messages WHERE room_id=?)").run(room.id);
  db.prepare("DELETE FROM rooms_streams WHERE message_id IN (SELECT id FROM rooms_messages WHERE room_id=?)").run(room.id);
  db.prepare("DELETE FROM rooms_steering WHERE activation_id IN (SELECT id FROM rooms_activations WHERE room_id=?)").run(room.id);
  db.prepare("DELETE FROM rooms_receipts WHERE scope IN (SELECT id FROM rooms_activations WHERE room_id=?) OR scope LIKE ? OR scope IN (SELECT 'queue-cancellation:' || id FROM rooms_activations WHERE room_id=?)").run(room.id, `human:${room.id}:%`, room.id);
  for (const table of ["rooms_activations", "rooms_deliveries", "rooms_messages", "rooms_agents", "rooms_invites", "rooms_members"]) db.prepare(`DELETE FROM ${table} WHERE room_id=?`).run(room.id);
  if (db.prepare("DELETE FROM rooms_rooms WHERE id=?").run(room.id).changes !== 1) throw new Error("QA room removal failed");
  for (const user of users) {
    db.prepare("DELETE FROM rooms_sessions WHERE user_id=?").run(user.id);
    db.prepare("DELETE FROM rooms_users WHERE id=?").run(user.id);
  }
  if (protectedState() !== before) throw new Error("Workshop changed during cleanup transaction");
})();
db.close();
await rm(`${data}/workspaces/${room.id}`, { recursive: true, force: true });
await writeFile(`${evidence}/cleanup.json`, JSON.stringify({ roomId: room.id, archivedThreads: threads.map((thread) => thread.id), removedUsers: users.map((user) => user.id), workshopUnchanged: true, completed: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ cleanedRoomId: room.id, archivedThreads: threads.length, removedUsers: users.length, workshopUnchanged: true }));
