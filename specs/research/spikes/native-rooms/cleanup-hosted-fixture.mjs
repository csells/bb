import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, lstat, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const QA = "/Users/admin/rooms-native-qa";
const REPO = "/Users/admin/code/Forks/get-bb/bb-native-rooms";
const FIXTURE = join(QA, "hosted-native-20261010-2");
const ROOMS = "/Users/admin/rooms-v2-data/rooms.sqlite";
const CORE = "/Users/admin/rooms-bb-data/bb.db";
const BACKUP = join(QA, "preview-cutover-20261010T190150Z");
const WORKSHOP = "606b2f3e-4501-45f4-a4fd-83bae65f447a";
const apply = process.argv.includes("--apply");
assert(process.argv.slice(2).every((arg) => arg === "--apply"));
process.umask(0o077);

const fixture = JSON.parse(await readFile(join(FIXTURE, "fixture-private.json"), "utf8"));
const evidence = JSON.parse(await readFile(join(QA, "hosted-dialogue-final/evidence.json"), "utf8"));
assert.equal(evidence.passed, true);
assert.deepEqual(evidence.errors, []);
assert.equal(fixture.data, "/Users/admin/rooms-v2-data");
assert.equal(fixture.workspace, join(FIXTURE, "project"));
assert.notEqual(fixture.operator.id, fixture.operator2.id);
const dialogueIds = [...new Set(evidence.steps.flatMap((step) => step.roomId ? [step.roomId] : []))];
assert.equal(dialogueIds.length, 1);
const roomIds = [fixture.roomId, dialogueIds[0]];
assert.equal(new Set(roomIds).size, 2);
assert(!roomIds.includes(WORKSHOP));
assert.deepEqual(roomIds, ["7a2ce44b-4551-4034-9afb-9389b3ff0d15", "2e7c82fe-b58e-4e0a-affb-23d417118968"]);
assert.equal(fixture.projectId, "proj_adqtsuub4t");
const require = createRequire(join(REPO, "packages/db/package.json"));
const Database = require("better-sqlite3");
const rooms = new Database(ROOMS, { readonly: !apply, fileMustExist: true });
const core = new Database(CORE, { readonly: true, fileMustExist: true });
rooms.pragma("foreign_keys = ON");
rooms.pragma("busy_timeout = 5000");
const { createNodeBbSdk } = await import(pathToFileURL(join(REPO, "packages/sdk/dist/node.js")));
const sdk = createNodeBbSdk({ baseUrl: "http://127.0.0.1:38886", timeoutMs: 30000 });
const marks = (ids) => ids.map(() => "?").join(",");
const selectIn = (db, table, column, ids) => ids.length ? db.prepare(`SELECT * FROM ${table} WHERE ${column} IN (${marks(ids)}) ORDER BY rowid`).all(...ids) : [];
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const report = { apply, roomIds, projectId: fixture.projectId, startedAt: new Date().toISOString(), steps: [] };

function protectedRows() {
  return {
    workshop: ["rooms_rooms", "rooms_messages", "rooms_agents", "rooms_members"].map((table) => ({
      table,
      rows: selectIn(rooms, table, table === "rooms_rooms" ? "id" : "room_id", [WORKSHOP]),
    })),
    owner: rooms.prepare("SELECT * FROM rooms_users WHERE id=?").get(fixture.operator.id),
    sessions: rooms.prepare("SELECT * FROM rooms_sessions WHERE user_id=? ORDER BY hash").all(fixture.operator.id),
  };
}

const protectedBefore = protectedRows();
assert(protectedBefore.owner);
assert.equal(protectedBefore.owner.handle, fixture.operator.handle);
const workshopThreadIds = protectedBefore.workshop.find((entry) => entry.table === "rooms_agents").rows.map((agent) => agent.thread_id);
const protectedNative = selectIn(core, "threads", "id", workshopThreadIds);
assert.equal(protectedNative.length, 2);
const baseline = JSON.parse(execFileSync("python3", ["-c", `
import sqlite3,json,sys
backup,rooms_path,core_path,room_id,guest_id=sys.argv[1:]
old=sqlite3.connect('file:'+backup+'/rooms.sqlite?immutable=1',uri=True); old.row_factory=sqlite3.Row
now=sqlite3.connect('file:'+rooms_path+'?mode=ro',uri=True); now.row_factory=sqlite3.Row
before=sqlite3.connect('file:'+backup+'/bb.db?immutable=1',uri=True); before.row_factory=sqlite3.Row
after=sqlite3.connect('file:'+core_path+'?mode=ro',uri=True); after.row_factory=sqlite3.Row
result={'roomTables':{},'nativeThreads':[],'differences':[],'roomRevision':None}
for table in ['rooms_rooms','rooms_messages','rooms_agents','rooms_members']:
 column='id' if table=='rooms_rooms' else 'room_id'
 rows=old.execute('SELECT * FROM '+table+' WHERE '+column+'=?',(room_id,)).fetchall()
 current={tuple(row[key] for key in (['room_id','user_id'] if table=='rooms_members' else ['id'])):dict(row) for row in now.execute('SELECT * FROM '+table+' WHERE '+column+'=?',(room_id,))}
 result['roomTables'][table]=len(rows)
 for row in rows:
  key=tuple(row[key] for key in (['room_id','user_id'] if table=='rooms_members' else ['id']))
  match=current.get(key)
  for name,value in dict(row).items():
   if table=='rooms_rooms' and name=='revision' and match is not None:
    result['roomRevision']={'backup':value,'beforeCleanup':match[name]}
   elif match is None or (name in match and match[name]!=value): result['differences'].append({'table':table,'row':key,'column':name})
assert old.execute('SELECT id FROM rooms_users WHERE id=?',(guest_id,)).fetchone() is None
for row in old.execute('SELECT thread_id FROM rooms_agents WHERE room_id=?',(room_id,)):
 thread_id=row[0]; a=before.execute('SELECT * FROM threads WHERE id=?',(thread_id,)).fetchone(); b=after.execute('SELECT * FROM threads WHERE id=?',(thread_id,)).fetchone()
 assert a is not None and b is not None
 changed=[key for key in a.keys() if key in b.keys() and a[key]!=b[key]]
 result['nativeThreads'].append({'threadId':thread_id,'changedColumns':changed})
 for key in changed:
  if key not in ['last_read_at','latest_attention_at','updated_at']: result['differences'].append({'table':'threads','row':thread_id,'column':key})
print(json.dumps(result))
`, BACKUP, ROOMS, CORE, WORKSHOP, fixture.operator2.id], { encoding: "utf8" }));
assert.deepEqual(baseline.differences, []);
report.baseline = baseline;

const evidenceMessageIds = new Set();
const evidenceActivationIds = new Set();
const evidenceAgents = new Map();
function visit(value) {
  if (!value || typeof value !== "object") return;
  if (value.roomId === dialogueIds[0]) {
    if (value.kind && value.id) evidenceMessageIds.add(value.id);
    if (value.messageId) evidenceMessageIds.add(value.messageId);
    if (value.causeId) evidenceMessageIds.add(value.causeId);
    if (value.activationId) evidenceActivationIds.add(value.activationId);
  }
  if (value.id && value.threadId && value.provider && value.projectId === fixture.projectId) evidenceAgents.set(value.id, value.threadId);
  for (const child of Object.values(value)) visit(child);
}
visit(evidence);

function fixtureRows() {
  const result = {};
  for (const table of ["rooms_rooms", "rooms_agents", "rooms_messages", "rooms_deliveries", "rooms_activations", "rooms_members", "rooms_invites"])
    result[table] = selectIn(rooms, table, table === "rooms_rooms" ? "id" : "room_id", roomIds);
  result.rooms_streams = selectIn(rooms, "rooms_streams", "message_id", result.rooms_messages.map((message) => message.id));
  result.rooms_chunks = selectIn(rooms, "rooms_chunks", "message_id", result.rooms_messages.map((message) => message.id));
  result.rooms_steering = selectIn(rooms, "rooms_steering", "activation_id", result.rooms_activations.map((activation) => activation.id));
  return result;
}

function verifyFixture(rows) {
  assert.equal(rows.rooms_rooms.length, 2);
  for (const room of rows.rooms_rooms) {
    assert.equal(room.owner_id, fixture.operator.id);
    assert.equal(room.project_id, fixture.projectId);
  }
  assert.equal(rows.rooms_agents.length, 2);
  for (const agent of rows.rooms_agents) {
    assert.equal(agent.room_id, dialogueIds[0]);
    assert.equal(agent.thread_id, evidenceAgents.get(agent.id));
    assert.equal(agent.project_id, fixture.projectId);
    assert(!workshopThreadIds.includes(agent.thread_id));
  }
  for (const message of rows.rooms_messages) {
    assert.equal(message.room_id, dialogueIds[0]);
    assert(evidenceMessageIds.has(message.id) || (message.kind === "agent" && evidenceActivationIds.has(message.activation_id)), "A message does not belong to exported dialogue evidence");
    assert.equal(message.status, "complete");
  }
  assert(rows.rooms_deliveries.every((delivery) => ["complete", "cancelled", "failed"].includes(delivery.state)), "Pending or uncertain room delivery");
  assert(rows.rooms_activations.every((activation) => ["settled", "failed", "cancelled"].includes(activation.state)), "Active or uncertain activation");
  assert(rows.rooms_activations.every((activation) => !activation.credential_path), "Private activation credential still needs revocation");
  assert(rows.rooms_steering.every((steering) => steering.state !== "pending"), "Pending steering");
  assert(rows.rooms_streams.every((stream) => ["committed", "aborted"].includes(stream.state)), "Open publication stream");
  assert(rows.rooms_members.every((member) => [fixture.operator.id, fixture.operator2.id].includes(member.user_id)), "Unrecognized room member");
  for (const table of ["rooms_members", "rooms_messages", "rooms_rooms"]) {
    const userColumn = { rooms_members: "user_id", rooms_messages: "author_id", rooms_rooms: "owner_id" }[table];
    const roomColumn = table === "rooms_rooms" ? "id" : "room_id";
    assert.equal(rooms.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${userColumn}=? AND ${roomColumn} NOT IN (${marks(roomIds)})`).get(fixture.operator2.id, ...roomIds).n, 0, "Fixture guest has unrelated work");
  }
  assert.equal(rooms.prepare(`SELECT count(*) AS n FROM rooms_rooms WHERE project_id=? AND id NOT IN (${marks(roomIds)})`).get(fixture.projectId, ...roomIds).n, 0, "Fixture project has another room");
  const native = selectIn(core, "threads", "project_id", [fixture.projectId]);
  assert.deepEqual(native.map((thread) => thread.id).sort(), rows.rooms_agents.map((agent) => agent.thread_id).sort(), "Fixture project has unrelated native work");
  for (const thread of native) {
    assert.equal(thread.status, "idle");
    assert.equal(thread.deleted_at, null);
    assert.equal(core.prepare("SELECT count(*) AS n FROM threads WHERE parent_thread_id=? OR lifecycle_owner_thread_id=?").get(thread.id, thread.id).n, 0, "Archive would affect a child thread");
    assert.equal(core.prepare("SELECT count(*) AS n FROM queued_thread_messages WHERE thread_id=?").get(thread.id).n, 0);
    assert.equal(core.prepare("SELECT count(*) AS n FROM pending_interactions WHERE thread_id=? AND status='pending'").get(thread.id).n, 0);
  }
}

function verifyProtected() {
  const after = protectedRows();
  assert.equal(hash(after.owner), hash(protectedBefore.owner), "Chris account changed");
  for (const oldSession of protectedBefore.sessions)
    assert(after.sessions.some((session) => hash(session) === hash(oldSession)), "Chris session changed or disappeared");
  for (const entry of protectedBefore.workshop) {
    const current = after.workshop.find((candidate) => candidate.table === entry.table).rows;
    for (const row of entry.rows) assert(current.some((candidate) => hash(candidate) === hash(row)), "Workshop row changed");
  }
  for (const previous of protectedNative) {
    const current = core.prepare("SELECT * FROM threads WHERE id=?").get(previous.id);
    for (const column of Object.keys(previous).filter((name) => !["last_read_at", "latest_attention_at", "updated_at"].includes(name)))
      assert.equal(current[column], previous[column], "Workshop native thread changed");
  }
}

const initial = fixtureRows();
verifyFixture(initial);
verifyProtected();
report.threadIds = initial.rooms_agents.map((agent) => agent.thread_id);
report.counts = Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.length]));
report.fixtureMessages = initial.rooms_messages.map((message) => ({ id: message.id, sha256: hash(message), activationId: message.activation_id }));
report.removeUserId = fixture.operator2.id;
report.preservedOwnerSessions = protectedBefore.sessions.length;
report.removeWorkspace = fixture.workspace;
report.removePrivateFile = join(FIXTURE, "fixture-private.json");
report.gatewayConfigurationChangeNeeded = false;
assert(!(await lstat(fixture.workspace)).isSymbolicLink());
assert.equal(await realpath(fixture.workspace), fixture.workspace);
const host = await sdk.hosts.get({ hostId: fixture.hostId });
assert(host.threadStorageRootPath);
report.privateParticipationDirectories = roomIds.map((roomId) => join(host.threadStorageRootPath, ".rooms", roomId));

if (apply) {
  for (const room of initial.rooms_rooms) {
    const response = await fetch(`http://127.0.0.1:38900/api/rooms/${room.id}/policy`, {
      method: "PUT",
      headers: { authorization: `Bearer ${fixture.ownerToken}`, "content-type": "application/json", "X-Rooms-Request": "1" },
      body: JSON.stringify({ paused: true, maxActivations: room.max_activations }),
    });
    assert.equal(response.status, 200, "Could not pause fixture room");
  }
  const paused = fixtureRows();
  verifyFixture(paused);
  for (const table of Object.keys(initial).filter((table) => table !== "rooms_rooms"))
    assert.equal(hash(paused[table]), hash(initial[table]), "Fixture changed while pausing");
  for (const threadId of report.threadIds) {
    const current = await sdk.threads.get({ threadId });
    assert.equal(current.status, "idle");
    const result = await sdk.threads.archive({ threadId });
    assert.deepEqual(result.archivedThreadIds, [threadId]);
  }
  report.steps.push("Archived both exact fixture native threads through the SDK");
  const scopes = new Set(paused.rooms_activations.flatMap((activation) => [activation.id, `queue-cancellation:${activation.id}`]));
  for (const steering of paused.rooms_steering) scopes.add(`steering-publication:${steering.id}`);
  for (const roomId of roomIds)
    for (const userId of [fixture.operator.id, fixture.operator2.id]) scopes.add(`human:${roomId}:${userId}`);
  rooms.transaction(() => {
    const current = fixtureRows();
    assert.equal(hash(current), hash(paused), "Fixture changed after archive; refusing deletion");
    verifyFixture(current);
    verifyProtected();
    const remove = (table, column, ids) => ids.length ? rooms.prepare(`DELETE FROM ${table} WHERE ${column} IN (${marks(ids)})`).run(...ids).changes : 0;
    const messages = current.rooms_messages.map((message) => message.id);
    const activations = current.rooms_activations.map((activation) => activation.id);
    remove("rooms_chunks", "message_id", messages);
    remove("rooms_streams", "message_id", messages);
    remove("rooms_steering", "activation_id", activations);
    for (const table of ["rooms_activations", "rooms_deliveries", "rooms_messages", "rooms_agents", "rooms_invites", "rooms_members"])
      remove(table, "room_id", roomIds);
    remove("rooms_rooms", "id", roomIds);
    report.removedReceipts = remove("rooms_receipts", "scope", [...scopes]);
    report.removedGuestSessions = remove("rooms_sessions", "user_id", [fixture.operator2.id]);
    assert.equal(remove("rooms_users", "id", [fixture.operator2.id]), 1);
    verifyProtected();
  }).immediate();
  report.steps.push("Removed only exact fixture Rooms rows, receipt scopes, and guest in one transaction");
  await sdk.projects.delete({ projectId: fixture.projectId });
  const deadline = Date.now() + 30000;
  while (core.prepare("SELECT id FROM projects WHERE id=?").get(fixture.projectId) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(core.prepare("SELECT id FROM projects WHERE id=?").get(fixture.projectId), undefined, "Project deletion has not finished; private files retained for retry");
  assert.equal(core.prepare("SELECT count(*) AS n FROM threads WHERE project_id=?").get(fixture.projectId).n, 0);
  report.steps.push("SDK project deletion completed for the isolated fixture project");
  for (const directory of report.privateParticipationDirectories) {
    try {
      assert(!(await lstat(directory)).isSymbolicLink());
      assert.equal(await realpath(directory), directory);
      await rm(directory, { recursive: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await rm(fixture.workspace, { recursive: true });
  await rm(join(FIXTURE, "fixture-private.json"));
  verifyProtected();
  report.steps.push("Removed exact fixture workspace and private copies; Chris and Workshop preserved");
}

report.passed = true;
report.workshopRevisionAfter = rooms.prepare("SELECT revision FROM rooms_rooms WHERE id=?").get(WORKSHOP).revision;
report.completedAt = new Date().toISOString();
await writeFile(join(QA, apply ? "hosted-cleanup.json" : "hosted-cleanup-dry-run.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
rooms.close();
core.close();
console.log(JSON.stringify(report));
