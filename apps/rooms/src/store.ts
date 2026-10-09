import Database from "better-sqlite3";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  agentSchema,
  deliverySchema,
  messageSchema,
  roomSchema,
  userSchema,
  type Agent,
  type Delivery,
  type Message,
  type User,
} from "./contracts.js";
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString("base64url");
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export class RoomError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const jsonRow = z.object({ data: z.string() });
const decode = (row: unknown) => JSON.parse(jsonRow.parse(row).data);
export class RoomsStore {
  readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,handle TEXT UNIQUE NOT NULL,data TEXT NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(room_id TEXT NOT NULL REFERENCES rooms(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id),role TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id),handle TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(room_id,handle));
CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,room_id TEXT NOT NULL REFERENCES rooms(id),source_key TEXT UNIQUE NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS room_messages ON messages(room_id,seq);
CREATE TABLE IF NOT EXISTS deliveries(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,room_id TEXT NOT NULL,agent_id TEXT NOT NULL,message_id TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(agent_id,message_id));
CREATE INDEX IF NOT EXISTS delivery_work ON deliveries(state,seq);`);
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  createRoom(name: string, ownerId: string) {
    const room = { id: id(), name, ownerId, defaultAgentId: null, revision: 0 };
    this.db
      .prepare("INSERT INTO rooms VALUES(?,?)")
      .run(room.id, JSON.stringify(room));
    if (ownerId)
      this.db
        .prepare("INSERT INTO members VALUES(?,?,?)")
        .run(room.id, ownerId, "owner");
    return room;
  }
  room(roomId: string) {
    const r = this.db.prepare("SELECT data FROM rooms WHERE id=?").get(roomId);
    if (!r) throw new RoomError(404, "Room not found");
    return roomSchema.parse(decode(r));
  }
  touch(roomId: string) {
    const r = this.room(roomId);
    r.revision++;
    this.db
      .prepare("UPDATE rooms SET data=? WHERE id=?")
      .run(JSON.stringify(r), roomId);
  }
  rooms(userId: string) {
    return this.db
      .prepare(
        "SELECT r.data FROM rooms r JOIN members m ON m.room_id=r.id WHERE m.user_id=? ORDER BY r.rowid DESC",
      )
      .all(userId)
      .map((r) => roomSchema.parse(decode(r)));
  }
  membership(roomId: string, userId: string, owner = false) {
    const r = this.db
      .prepare("SELECT role FROM members WHERE room_id=? AND user_id=?")
      .get(roomId, userId);
    if (!r) throw new RoomError(403, "You are not a member of this room");
    const role = z.object({ role: z.string() }).parse(r).role;
    if (owner && role !== "owner")
      throw new RoomError(403, "Only the room owner can do that");
    return role;
  }
  members(roomId: string) {
    return this.db
      .prepare(
        "SELECT u.data,m.role FROM users u JOIN members m ON m.user_id=u.id WHERE m.room_id=?",
      )
      .all(roomId)
      .map((r) => ({
        ...userSchema.parse(decode(r)),
        role: z.object({ role: z.enum(["owner", "member"]) }).parse(r).role,
      }));
  }
  invite(roomId: string, role = "member") {
    const raw = token();
    this.db
      .prepare("INSERT INTO invites(hash,room_id,role,expires) VALUES(?,?,?,?)")
      .run(hash(raw), roomId, role, Date.now() + 7 * 86400000);
    return raw;
  }
  register(raw: string, handle: string, name: string, password: string) {
    const salt = token();
    const passwordHash =
      salt + ":" + scryptSync(password, salt, 64).toString("hex");
    return this.transaction(() => {
      const inv = this.db
        .prepare(
          "SELECT room_id,role FROM invites WHERE hash=? AND used=0 AND expires>?",
        )
        .get(hash(raw), Date.now());
      if (!inv) throw new RoomError(403, "Invitation expired or already used");
      if (this.db.prepare("SELECT id FROM users WHERE handle=?").get(handle))
        throw new RoomError(
          409,
          "That handle is taken. Sign in to your existing account.",
        );
      const i = z.object({ room_id: z.string(), role: z.string() }).parse(inv);
      const u = { id: id(), handle, name };
      this.db
        .prepare("INSERT INTO users VALUES(?,?,?,?)")
        .run(u.id, handle, JSON.stringify(u), passwordHash);
      this.acceptInvite(raw, u, i);
      return u;
    });
  }
  acceptInvite(raw: string, u: User, inv?: { room_id: string; role: string }) {
    return this.transaction(() => {
      const i =
        inv ??
        z
          .object({ room_id: z.string(), role: z.string() })
          .parse(
            this.db
              .prepare(
                "SELECT room_id,role FROM invites WHERE hash=? AND used=0 AND expires>?",
              )
              .get(hash(raw), Date.now()),
          );
      if (this.agents(i.room_id).some((a) => a.handle === u.handle))
        throw new RoomError(
          409,
          "That handle belongs to an agent in this room",
        );
      this.db.prepare("UPDATE invites SET used=1 WHERE hash=?").run(hash(raw));
      this.db
        .prepare("INSERT OR IGNORE INTO members VALUES(?,?,?)")
        .run(i.room_id, u.id, i.role);
      if (i.role === "owner") {
        const r = this.room(i.room_id);
        if (r.ownerId) throw new RoomError(409, "Room already claimed");
        r.ownerId = u.id;
        this.db
          .prepare("UPDATE rooms SET data=? WHERE id=?")
          .run(JSON.stringify(r), r.id);
      }
      this.touch(i.room_id);
      return this.room(i.room_id);
    });
  }
  login(handle: string, password: string) {
    const r = this.db
      .prepare("SELECT data,password FROM users WHERE handle=?")
      .get(handle);
    const parsed = r ? z.object({ password: z.string() }).parse(r) : null;
    const [salt, expected] = (
      parsed?.password ?? "missing:" + Buffer.alloc(64).toString("hex")
    ).split(":");
    const actual = scryptSync(password, salt, 64);
    if (!parsed || !timingSafeEqual(actual, Buffer.from(expected, "hex")))
      throw new RoomError(401, "Incorrect handle or password");
    return userSchema.parse(decode(r));
  }
  session(userId: string) {
    const raw = token();
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(hash(raw), userId, Date.now() + 7 * 86400000);
    return raw;
  }
  authenticate(raw: string) {
    const r = this.db
      .prepare(
        "SELECT u.data FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>?",
      )
      .get(hash(raw), Date.now());
    if (!r) throw new RoomError(401, "Sign in to continue");
    return userSchema.parse(decode(r));
  }
  logout(raw: string) {
    this.db.prepare("DELETE FROM sessions WHERE hash=?").run(hash(raw));
  }
  removeMember(roomId: string, userId: string) {
    if (this.room(roomId).ownerId === userId)
      throw new RoomError(409, "The owner cannot be removed");
    this.db
      .prepare("DELETE FROM members WHERE room_id=? AND user_id=?")
      .run(roomId, userId);
    this.touch(roomId);
  }
  agents(roomId: string) {
    return this.db
      .prepare("SELECT data FROM agents WHERE room_id=? ORDER BY rowid")
      .all(roomId)
      .map((r) => agentSchema.parse(decode(r)));
  }
  agent(agentId: string) {
    const r = this.db
      .prepare("SELECT data FROM agents WHERE id=?")
      .get(agentId);
    if (!r) throw new RoomError(404, "Agent not found");
    return agentSchema.parse(decode(r));
  }
  addAgent(
    roomId: string,
    input: Pick<
      Agent,
      "handle" | "name" | "provider" | "model" | "instructions"
    >,
  ) {
    if (this.agents(roomId).length >= 8)
      throw new RoomError(409, "A room supports up to eight agents");
    if (
      this.agents(roomId).some((a) => a.handle === input.handle) ||
      this.members(roomId).some((u) => u.handle === input.handle)
    )
      throw new RoomError(409, "That participant handle is already in use");
    const a: Agent = {
      ...input,
      id: id(),
      roomId,
      projectId: null,
      threadId: null,
      lastSeq: 0,
      status: "idle",
    };
    this.db
      .prepare("INSERT INTO agents VALUES(?,?,?,?)")
      .run(a.id, roomId, a.handle, JSON.stringify(a));
    this.touch(roomId);
    return a;
  }
  saveAgent(a: Agent) {
    this.db
      .prepare("UPDATE agents SET data=? WHERE id=?")
      .run(JSON.stringify(a), a.id);
    this.touch(a.roomId);
  }
  setDefault(roomId: string, agentId: string | null) {
    if (agentId && !this.agents(roomId).some((a) => a.id === agentId))
      throw new RoomError(400, "Unknown agent");
    const r = this.room(roomId);
    r.defaultAgentId = agentId;
    r.revision++;
    this.db
      .prepare("UPDATE rooms SET data=? WHERE id=?")
      .run(JSON.stringify(r), roomId);
  }
  messages(roomId: string, limit = 300) {
    return this.db
      .prepare(
        "SELECT data FROM (SELECT seq,data FROM messages WHERE room_id=? ORDER BY seq DESC LIMIT ?) ORDER BY seq",
      )
      .all(roomId, limit)
      .map((r) => messageSchema.parse(decode(r)));
  }
  message(messageId: string) {
    const r = this.db
      .prepare("SELECT data FROM messages WHERE id=?")
      .get(messageId);
    if (!r) throw new RoomError(404, "Message not found");
    return messageSchema.parse(decode(r));
  }
  putMessage(m: Message, key: string) {
    const old = this.db
      .prepare("SELECT data FROM messages WHERE source_key=?")
      .get(key);
    if (old) {
      const prev = messageSchema.parse(decode(old));
      m = { ...m, id: prev.id, createdAt: prev.createdAt };
      if (JSON.stringify(prev) === JSON.stringify(m)) return prev;
      this.db
        .prepare("UPDATE messages SET data=? WHERE source_key=?")
        .run(JSON.stringify(m), key);
    } else
      this.db
        .prepare(
          "INSERT INTO messages(id,room_id,source_key,data) VALUES(?,?,?,?)",
        )
        .run(m.id, m.roomId, key, JSON.stringify(m));
    this.touch(m.roomId);
    return m;
  }
  requestMessage(user: User, roomId: string, text: string, requestId: string) {
    const key = `human:${roomId}:${user.id}:${requestId}`;
    const old = this.db
      .prepare("SELECT data FROM messages WHERE source_key=?")
      .get(key);
    if (old)
      return { message: messageSchema.parse(decode(old)), duplicate: true };
    return {
      message: this.putMessage(
        {
          id: id(),
          roomId,
          authorId: user.id,
          authorName: user.name,
          kind: "human",
          text,
          status: "complete",
          createdAt: Date.now(),
          causeId: null,
          depth: 0,
        },
        key,
      ),
      duplicate: false,
    };
  }
  enqueue(agentId: string, m: Message) {
    const d: Delivery = {
      id: id(),
      roomId: m.roomId,
      agentId,
      messageId: m.id,
      state: "queued",
      error: null,
      startedAt: null,
      baseline: 0,
    };
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO deliveries(id,room_id,agent_id,message_id,state,data) VALUES(?,?,?,?,?,?)",
      )
      .run(d.id, d.roomId, agentId, m.id, d.state, JSON.stringify(d));
    if (result.changes) this.touch(m.roomId);
  }
  deliveries(roomId: string) {
    return this.db
      .prepare(
        "SELECT data FROM deliveries WHERE room_id=? ORDER BY seq DESC LIMIT 100",
      )
      .all(roomId)
      .map((r) => deliverySchema.parse(decode(r)));
  }
  work() {
    return this.db
      .prepare(
        "SELECT data FROM deliveries WHERE state IN ('queued','dispatching','running') ORDER BY seq",
      )
      .all()
      .map((r) => deliverySchema.parse(decode(r)));
  }
  saveDelivery(d: Delivery) {
    this.db
      .prepare("UPDATE deliveries SET state=?,data=? WHERE id=?")
      .run(d.state, JSON.stringify(d), d.id);
    this.touch(d.roomId);
  }
  updateMessage(m: Message) {
    this.db
      .prepare("UPDATE messages SET data=? WHERE id=?")
      .run(JSON.stringify(m), m.id);
    this.touch(m.roomId);
  }
  close() {
    this.db.close();
  }
}
