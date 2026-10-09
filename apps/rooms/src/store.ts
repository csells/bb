import { createConnection, migrate } from "@bb/db";
import type Database from "better-sqlite3";
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
  activationSchema,
  agentCommandResultSchema,
  type Agent,
  type Delivery,
  type Message,
  type User,
  type Publication,
  type AgentCommand,
  type AgentCommandResult,
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
const roomColumns = `id,name,owner_id AS ownerId,revision,paused,pause_reason AS pauseReason,max_activations AS maxActivations,activations_used AS activationsUsed`;
const agentColumns = `id,room_id AS roomId,handle,name,provider,model,instructions,project_id AS projectId,thread_id AS threadId,status`;
const messageColumns = `id,room_id AS roomId,author_id AS authorId,author_name AS authorName,kind,text,status,created_at AS createdAt,cause_id AS causeId,intent,recipients,reply_to AS replyTo`;
const deliveryColumns = `id,room_id AS roomId,agent_id AS agentId,message_id AS messageId,state,error,created_at AS createdAt,started_at AS startedAt,intent,activation_id AS activationId,thread_id AS threadId,outcome`;
const activationColumns = `id,agent_id AS agentId,room_id AS roomId,delivery_id AS deliveryId,state,thread_id AS threadId,epoch,revoked,stop_requested AS stopRequested`;
const storedRoom = roomSchema.extend({ paused: z.number().transform(Boolean) });
const storedMessage = messageSchema.extend({
  recipients: z
    .string()
    .transform((v) => z.array(z.string()).parse(JSON.parse(v))),
});
const storedActivation = activationSchema.extend({
  revoked: z.number().transform(Boolean),
  stopRequested: z.number().transform(Boolean),
});
const receiptSchema = z.object({ payload: z.string(), response: z.string() });
const countSchema = z.object({ count: z.number() });
const streamSchema = z.object({
  message_id: z.string(),
  activation_id: z.string(),
  state: z.enum(["open", "committed", "aborted"]),
  next_sequence: z.number(),
  commit_payload: z.string().nullable(),
});
const canonical = (value: unknown): string => JSON.stringify(value);
export class RoomsStore {
  readonly db: Database.Database;
  constructor(path: string) {
    const connection = createConnection(path);
    migrate(connection);
    this.db = connection.$client;
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  createRoom(name: string, ownerId: string) {
    return this.transaction(() => {
      const roomId = id();
      this.db
        .prepare("INSERT INTO rooms_rooms(id,name,owner_id) VALUES(?,?,?)")
        .run(roomId, name, ownerId);
      if (ownerId)
        this.db
          .prepare("INSERT INTO rooms_members VALUES(?,?,?)")
          .run(roomId, ownerId, "owner");
      return this.room(roomId);
    });
  }
  room(roomId: string) {
    const row = this.db
      .prepare(`SELECT ${roomColumns} FROM rooms_rooms WHERE id=?`)
      .get(roomId);
    if (!row) throw new RoomError(404, "Room not found");
    return storedRoom.parse(row);
  }
  touch(roomId: string) {
    this.db
      .prepare("UPDATE rooms_rooms SET revision=revision+1 WHERE id=?")
      .run(roomId);
  }
  rooms(userId: string) {
    return this.db
      .prepare(
        `SELECT ${roomColumns} FROM rooms_rooms WHERE id IN (SELECT room_id FROM rooms_members WHERE user_id=?) ORDER BY rowid DESC`,
      )
      .all(userId)
      .map((r) => storedRoom.parse(r));
  }
  membership(roomId: string, userId: string, owner = false) {
    const row = this.db
      .prepare("SELECT role FROM rooms_members WHERE room_id=? AND user_id=?")
      .get(roomId, userId);
    if (!row) throw new RoomError(403, "You are not a member of this room");
    const role = z.object({ role: z.string() }).parse(row).role;
    if (owner && role !== "owner")
      throw new RoomError(403, "Only the room owner can do that");
    return role;
  }
  members(roomId: string) {
    return this.db
      .prepare(
        "SELECT u.id,u.handle,u.name,m.role FROM rooms_users u JOIN rooms_members m ON m.user_id=u.id WHERE m.room_id=?",
      )
      .all(roomId)
      .map((r) =>
        userSchema.extend({ role: z.enum(["owner", "member"]) }).parse(r),
      );
  }
  invite(roomId: string, role = "member") {
    this.room(roomId);
    const raw = token();
    this.db
      .prepare(
        "INSERT INTO rooms_invites(hash,room_id,role,expires) VALUES(?,?,?,?)",
      )
      .run(hash(raw), roomId, role, Date.now() + 7 * 86400000);
    return raw;
  }
  register(raw: string, handle: string, name: string, password: string) {
    const salt = token(),
      passwordHash =
        salt + ":" + scryptSync(password, salt, 64).toString("hex");
    return this.transaction(() => {
      if (
        this.db.prepare("SELECT id FROM rooms_users WHERE handle=?").get(handle)
      )
        throw new RoomError(
          409,
          "That handle is taken. Sign in to your existing account.",
        );
      const user = { id: id(), handle, name };
      this.db
        .prepare("INSERT INTO rooms_users VALUES(?,?,?,?)")
        .run(user.id, handle, name, passwordHash);
      this.acceptInvite(raw, user);
      return user;
    });
  }
  acceptInvite(raw: string, user: User) {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT room_id,role FROM rooms_invites WHERE hash=? AND used=0 AND expires>?",
        )
        .get(hash(raw), Date.now());
      if (!row) throw new RoomError(403, "Invitation expired or already used");
      const invite = z
        .object({ room_id: z.string(), role: z.string() })
        .parse(row);
      if (
        this.db
          .prepare("SELECT id FROM rooms_agents WHERE room_id=? AND handle=?")
          .get(invite.room_id, user.handle)
      )
        throw new RoomError(
          409,
          "That handle belongs to an agent in this room",
        );
      this.db
        .prepare("UPDATE rooms_invites SET used=1 WHERE hash=?")
        .run(hash(raw));
      this.db
        .prepare("INSERT OR IGNORE INTO rooms_members VALUES(?,?,?)")
        .run(invite.room_id, user.id, invite.role);
      if (invite.role === "owner") {
        if (this.room(invite.room_id).ownerId)
          throw new RoomError(409, "Room already claimed");
        this.db
          .prepare("UPDATE rooms_rooms SET owner_id=? WHERE id=?")
          .run(user.id, invite.room_id);
      }
      this.touch(invite.room_id);
      return this.room(invite.room_id);
    });
  }
  login(handle: string, password: string) {
    const row = this.db
      .prepare("SELECT id,handle,name,password FROM rooms_users WHERE handle=?")
      .get(handle);
    const parsed = row
      ? userSchema.extend({ password: z.string() }).parse(row)
      : null;
    const [salt, expected] = (
      parsed?.password ?? "missing:" + Buffer.alloc(64).toString("hex")
    ).split(":");
    const actual = scryptSync(password, salt, 64);
    if (!parsed || !timingSafeEqual(actual, Buffer.from(expected, "hex")))
      throw new RoomError(401, "Incorrect handle or password");
    return userSchema.parse(parsed);
  }
  session(userId: string) {
    const raw = token();
    this.db
      .prepare("INSERT INTO rooms_sessions VALUES(?,?,?)")
      .run(hash(raw), userId, Date.now() + 7 * 86400000);
    return raw;
  }
  authenticate(raw: string) {
    const row = this.db
      .prepare(
        "SELECT u.id,u.handle,u.name FROM rooms_users u JOIN rooms_sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>?",
      )
      .get(hash(raw), Date.now());
    if (!row) throw new RoomError(401, "Sign in to continue");
    return userSchema.parse(row);
  }
  logout(raw: string) {
    this.db.prepare("DELETE FROM rooms_sessions WHERE hash=?").run(hash(raw));
  }
  removeMember(roomId: string, userId: string) {
    if (this.room(roomId).ownerId === userId)
      throw new RoomError(409, "The owner cannot be removed");
    this.db
      .prepare("DELETE FROM rooms_members WHERE room_id=? AND user_id=?")
      .run(roomId, userId);
    this.touch(roomId);
  }
  agents(roomId: string) {
    return this.db
      .prepare(
        `SELECT ${agentColumns} FROM rooms_agents WHERE room_id=? ORDER BY rowid`,
      )
      .all(roomId)
      .map((r) => agentSchema.parse(r));
  }
  agent(agentId: string) {
    const row = this.db
      .prepare(`SELECT ${agentColumns} FROM rooms_agents WHERE id=?`)
      .get(agentId);
    if (!row) throw new RoomError(404, "Agent not found");
    return agentSchema.parse(row);
  }
  addAgent(
    roomId: string,
    input: Pick<
      Agent,
      "handle" | "name" | "provider" | "model" | "instructions"
    >,
  ) {
    return this.transaction(() => {
      this.room(roomId);
      if (
        this.db
          .prepare("SELECT id FROM rooms_agents WHERE room_id=? AND handle=?")
          .get(roomId, input.handle) ||
        this.db
          .prepare(
            "SELECT u.id FROM rooms_users u JOIN rooms_members m ON u.id=m.user_id WHERE m.room_id=? AND u.handle=?",
          )
          .get(roomId, input.handle)
      )
        throw new RoomError(409, "That participant handle is already in use");
      const agentId = id();
      this.db
        .prepare(
          "INSERT INTO rooms_agents(id,room_id,handle,name,provider,model,instructions) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          agentId,
          roomId,
          input.handle,
          input.name,
          input.provider,
          input.model,
          input.instructions,
        );
      this.touch(roomId);
      return this.agent(agentId);
    });
  }
  saveAgent(a: Agent) {
    this.db
      .prepare(
        "UPDATE rooms_agents SET project_id=?,thread_id=?,status=? WHERE id=? AND room_id=?",
      )
      .run(a.projectId, a.threadId, a.status, a.id, a.roomId);
    this.touch(a.roomId);
  }
  setPolicy(
    roomId: string,
    policy: { paused: boolean; maxActivations: number | null },
  ) {
    return this.transaction(() => {
      const previous = this.room(roomId);
      this.db
        .prepare(
          "UPDATE rooms_rooms SET paused=?,pause_reason=?,max_activations=?,activations_used=? WHERE id=?",
        )
        .run(
          Number(policy.paused),
          policy.paused ? "Paused by a human" : null,
          policy.maxActivations,
          previous.paused && !policy.paused ? 0 : previous.activationsUsed,
          roomId,
        );
      this.touch(roomId);
      return this.room(roomId);
    });
  }
  messages(roomId: string, limit = 300) {
    return this.db
      .prepare(
        `SELECT ${messageColumns} FROM (SELECT * FROM rooms_messages WHERE room_id=? ORDER BY seq DESC LIMIT ?) ORDER BY seq`,
      )
      .all(roomId, limit)
      .map((r) => storedMessage.parse(r));
  }
  message(messageId: string) {
    const row = this.db
      .prepare(`SELECT ${messageColumns} FROM rooms_messages WHERE id=?`)
      .get(messageId);
    if (!row) throw new RoomError(404, "Message not found");
    return storedMessage.parse(row);
  }
  private insertMessage(m: Message, activationId: string | null) {
    this.db
      .prepare(
        "INSERT INTO rooms_messages(id,room_id,author_id,author_name,kind,text,status,created_at,cause_id,intent,recipients,reply_to,activation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        m.id,
        m.roomId,
        m.authorId,
        m.authorName,
        m.kind,
        m.text,
        m.status,
        m.createdAt,
        m.causeId,
        m.intent,
        JSON.stringify(m.recipients),
        m.replyTo,
        activationId,
      );
    this.touch(m.roomId);
    return m;
  }
  private validatePublication(
    roomId: string,
    input: Publication,
    authorId: string,
  ) {
    if (input.intent === "request" && !input.recipients.length)
      throw new RoomError(400, "A request needs at least one recipient");
    if (new Set(input.recipients).size !== input.recipients.length)
      throw new RoomError(400, "Duplicate recipient");
    for (const recipient of input.recipients) {
      if (recipient === authorId && input.intent !== "post")
        throw new RoomError(400, "An agent cannot wake itself");
      const a = this.db
        .prepare("SELECT id FROM rooms_agents WHERE id=? AND room_id=?")
        .get(recipient, roomId);
      const h = this.db
        .prepare(
          "SELECT user_id FROM rooms_members WHERE user_id=? AND room_id=?",
        )
        .get(recipient, roomId);
      if (!a && !h)
        throw new RoomError(400, "Recipient is not a member of this room");
    }
    if (input.replyTo && this.message(input.replyTo).roomId !== roomId)
      throw new RoomError(400, "Reply target belongs to another room");
  }
  private publish(
    author: { id: string; name: string; kind: "human" | "agent" },
    roomId: string,
    input: Publication,
    activationId: string | null,
    causeId: string | null,
  ) {
    this.validatePublication(roomId, input, author.id);
    const message = this.insertMessage(
      {
        id: id(),
        roomId,
        authorId: author.id,
        authorName: author.name,
        kind: author.kind,
        text: input.text,
        status: "complete",
        createdAt: Date.now(),
        causeId,
        intent: input.intent,
        recipients: input.recipients,
        replyTo: input.replyTo,
      },
      activationId,
    );
    if (input.intent !== "post")
      for (const target of input.recipients)
        if (
          this.db
            .prepare("SELECT id FROM rooms_agents WHERE id=? AND room_id=?")
            .get(target, roomId)
        )
          this.enqueue(target, message);
    return message;
  }
  private receipt(scope: string, requestId: string, payload: string) {
    const row = this.db
      .prepare(
        "SELECT payload,response FROM rooms_receipts WHERE scope=? AND request_id=?",
      )
      .get(scope, requestId);
    if (!row) return null;
    const receipt = receiptSchema.parse(row);
    if (receipt.payload !== payload)
      throw new RoomError(
        409,
        "Idempotency key already used with a different request",
      );
    return z.unknown().parse(JSON.parse(receipt.response));
  }
  private remember(
    scope: string,
    requestId: string,
    payload: string,
    response: unknown,
  ) {
    this.db
      .prepare("INSERT INTO rooms_receipts VALUES(?,?,?,?)")
      .run(scope, requestId, payload, canonical(response));
  }
  sendHuman(user: User, roomId: string, input: Publication, requestId: string) {
    return this.transaction(() => {
      this.membership(roomId, user.id);
      const scope = `human:${roomId}:${user.id}`,
        payload = canonical(input),
        old = this.receipt(scope, requestId, payload);
      if (old) return { message: messageSchema.parse(old), duplicate: true };
      const message = this.publish(
        { ...user, kind: "human" },
        roomId,
        input,
        null,
        null,
      );
      this.remember(scope, requestId, payload, message);
      return { message, duplicate: false };
    });
  }
  requestMessage(user: User, roomId: string, text: string, requestId: string) {
    return this.sendHuman(
      user,
      roomId,
      { text, intent: "post", recipients: [], replyTo: null },
      requestId,
    );
  }
  enqueue(agentId: string, m: Message) {
    if (this.agent(agentId).roomId !== m.roomId)
      throw new RoomError(400, "Agent belongs to another room");
    const now = Date.now();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO rooms_deliveries(id,room_id,agent_id,message_id,state,created_at,intent) VALUES(?,?,?,?,?,?,?)",
      )
      .run(id(), m.roomId, agentId, m.id, "queued", now, m.intent);
    this.touch(m.roomId);
  }
  deliveries(roomId: string) {
    return this.db
      .prepare(
        `SELECT ${deliveryColumns} FROM rooms_deliveries WHERE room_id=? ORDER BY seq DESC LIMIT 100`,
      )
      .all(roomId)
      .map((r) => deliverySchema.parse(r));
  }
  work() {
    return this.db
      .prepare(
        `SELECT ${deliveryColumns} FROM rooms_deliveries WHERE state IN ('queued','dispatching','running') OR activation_id IN (SELECT id FROM rooms_activations WHERE state IN ('dispatching','running')) ORDER BY seq`,
      )
      .all()
      .map((r) => deliverySchema.parse(r));
  }
  delivery(deliveryId: string) {
    const row = this.db
      .prepare(`SELECT ${deliveryColumns} FROM rooms_deliveries WHERE id=?`)
      .get(deliveryId);
    if (!row) throw new RoomError(404, "Delivery not found");
    return deliverySchema.parse(row);
  }
  saveDelivery(d: Delivery) {
    this.db
      .prepare(
        "UPDATE rooms_deliveries SET state=?,error=?,started_at=?,activation_id=?,thread_id=?,outcome=? WHERE id=?",
      )
      .run(
        d.state,
        d.error,
        d.startedAt,
        d.activationId,
        d.threadId,
        d.outcome,
        d.id,
      );
    this.touch(d.roomId);
  }
  activationForDelivery(deliveryId: string) {
    const row = this.db
      .prepare(
        `SELECT ${activationColumns} FROM rooms_activations WHERE delivery_id=?`,
      )
      .get(deliveryId);
    return row ? storedActivation.parse(row) : null;
  }
  activation(activationId: string) {
    const row = this.db
      .prepare(`SELECT ${activationColumns} FROM rooms_activations WHERE id=?`)
      .get(activationId);
    if (!row) throw new RoomError(404, "Activation not found");
    return storedActivation.parse(row);
  }
  beginActivation(deliveryId: string) {
    return this.transaction(() => {
      const delivery = this.delivery(deliveryId),
        room = this.room(delivery.roomId);
      if (delivery.state !== "queued" || room.paused) return null;
      if (
        room.maxActivations !== null &&
        room.activationsUsed >= room.maxActivations
      ) {
        this.db
          .prepare(
            "UPDATE rooms_rooms SET paused=1,pause_reason='Configured activation budget reached' WHERE id=?",
          )
          .run(room.id);
        this.touch(room.id);
        return null;
      }
      if (
        this.db
          .prepare(
            "SELECT id FROM rooms_activations WHERE agent_id=? AND state IN ('dispatching','running','uncertain')",
          )
          .get(delivery.agentId)
      )
        return null;
      const raw = token(),
        activationId = id();
      this.db
        .prepare(
          "UPDATE rooms_agents SET epoch=epoch+1,status='starting' WHERE id=?",
        )
        .run(delivery.agentId);
      const epoch = z
        .object({ epoch: z.number() })
        .parse(
          this.db
            .prepare("SELECT epoch FROM rooms_agents WHERE id=?")
            .get(delivery.agentId),
        ).epoch;
      this.db
        .prepare(
          "INSERT INTO rooms_activations(id,agent_id,room_id,delivery_id,state,epoch,capability_hash) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          activationId,
          delivery.agentId,
          room.id,
          deliveryId,
          "dispatching",
          epoch,
          hash(raw),
        );
      this.db
        .prepare(
          "UPDATE rooms_deliveries SET state='dispatching',activation_id=?,started_at=? WHERE id=? AND state='queued'",
        )
        .run(activationId, Date.now(), deliveryId);
      this.db
        .prepare(
          "UPDATE rooms_rooms SET activations_used=activations_used+1 WHERE id=?",
        )
        .run(room.id);
      this.touch(room.id);
      return { activation: this.activation(activationId), token: raw };
    });
  }
  bindActivation(activationId: string, threadId: string) {
    return this.transaction(() => {
      const a = this.activation(activationId);
      if (a.state !== "dispatching")
        throw new RoomError(409, "Activation is no longer dispatching");
      this.db
        .prepare(
          "UPDATE rooms_activations SET state='running',thread_id=? WHERE id=?",
        )
        .run(threadId, activationId);
      this.db
        .prepare(
          "UPDATE rooms_deliveries SET state=CASE WHEN state='stopped' THEN state ELSE 'running' END,thread_id=? WHERE id=?",
        )
        .run(threadId, a.deliveryId);
      this.db
        .prepare("UPDATE rooms_agents SET thread_id=?,status=? WHERE id=?")
        .run(threadId, a.revoked ? "stopping" : "working", a.agentId);
      this.touch(a.roomId);
    });
  }
  activationPublications(activationId: string) {
    return countSchema.parse(
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM rooms_messages WHERE activation_id=? AND status='complete'",
        )
        .get(activationId),
    ).count;
  }
  finishActivation(
    activationId: string,
    outcome: "replied" | "no_reply",
    error?: string,
  ) {
    return this.transaction(() => {
      const a = this.activation(activationId),
        d = this.delivery(a.deliveryId);
      if (!["dispatching", "running"].includes(a.state)) return;
      const stopped = d.state === "stopped";
      const actualOutcome =
        this.activationPublications(activationId) > 0 ? "replied" : outcome;
      this.db
        .prepare("UPDATE rooms_activations SET state=?,revoked=1 WHERE id=?")
        .run(stopped ? "stopped" : "settled", a.id);
      this.db
        .prepare(
          "UPDATE rooms_deliveries SET state=?,outcome=?,error=? WHERE id=?",
        )
        .run(
          stopped ? "stopped" : error ? "error" : "complete",
          actualOutcome,
          error ?? d.error,
          d.id,
        );
      this.abortStreams(activationId);
      this.db
        .prepare("UPDATE rooms_agents SET status=? WHERE id=?")
        .run(error ? "error" : "idle", a.agentId);
      this.touch(a.roomId);
    });
  }
  fenceAgent(agentId: string, reason: string) {
    return this.transaction(() => {
      const a = this.agent(agentId);
      this.db
        .prepare(
          "UPDATE rooms_activations SET revoked=1,stop_requested=1 WHERE agent_id=? AND state IN ('dispatching','running','uncertain')",
        )
        .run(agentId);
      this.db
        .prepare(
          "UPDATE rooms_deliveries SET state='stopped',error=? WHERE agent_id=? AND state IN ('queued','dispatching','running')",
        )
        .run(reason, agentId);
      for (const row of this.db
        .prepare(
          "SELECT id FROM rooms_activations WHERE agent_id=? AND state IN ('dispatching','running')",
        )
        .all(agentId))
        this.abortStreams(z.object({ id: z.string() }).parse(row).id);
      const active = this.db
        .prepare(
          "SELECT id FROM rooms_activations WHERE agent_id=? AND state IN ('dispatching','running')",
        )
        .get(agentId);
      this.db
        .prepare("UPDATE rooms_agents SET status=? WHERE id=?")
        .run(active ? "stopping" : "idle", agentId);
      this.touch(a.roomId);
    });
  }
  markActivationUncertain(activationId: string, error: string) {
    return this.transaction(() => {
      const a = this.activation(activationId);
      this.db
        .prepare(
          "UPDATE rooms_activations SET state='uncertain',revoked=1 WHERE id=?",
        )
        .run(a.id);
      this.db
        .prepare(
          "UPDATE rooms_deliveries SET state='uncertain',error=? WHERE id=?",
        )
        .run(error, a.deliveryId);
      this.db
        .prepare("UPDATE rooms_agents SET status='uncertain' WHERE id=?")
        .run(a.agentId);
      this.abortStreams(a.id);
      this.touch(a.roomId);
    });
  }
  recordQueueCancellation(
    activationId: string,
    threadId: string,
    queuedMessageId: string,
  ) {
    return this.transaction(() => {
      const activation = this.activation(activationId);
      if (!activation.revoked || !activation.stopRequested)
        throw new RoomError(
          409,
          "Fence the activation before cancelling queued admission",
        );
      if (activation.threadId !== null && activation.threadId !== threadId)
        throw new RoomError(
          409,
          "Cancellation belongs to another execution thread",
        );
      const scope = `queue-cancellation:${activationId}`;
      const payload = canonical({ threadId });
      if (!this.receipt(scope, queuedMessageId, payload))
        this.remember(scope, queuedMessageId, payload, {
          threadId,
          queuedMessageId,
        });
    });
  }
  hasQueueCancellation(activationId: string, threadId: string) {
    return (
      this.db
        .prepare(
          "SELECT request_id FROM rooms_receipts WHERE scope=? AND payload=? LIMIT 1",
        )
        .get(`queue-cancellation:${activationId}`, canonical({ threadId })) !==
      undefined
    );
  }
  uncertainActivations(agentId: string) {
    return this.db
      .prepare(
        `SELECT ${activationColumns} FROM rooms_activations WHERE agent_id=? AND state='uncertain'`,
      )
      .all(agentId)
      .map((row) => storedActivation.parse(row));
  }
  resolveUncertain(agentId: string) {
    return this.transaction(() => {
      const agent = this.agent(agentId);
      const uncertain = this.db
        .prepare(
          "SELECT id,delivery_id FROM rooms_activations WHERE agent_id=? AND state='uncertain'",
        )
        .all(agentId)
        .map((row) =>
          z.object({ id: z.string(), delivery_id: z.string() }).parse(row),
        );
      for (const activation of uncertain) {
        this.db
          .prepare(
            "UPDATE rooms_activations SET state='stopped',revoked=1,stop_requested=1 WHERE id=? AND state='uncertain'",
          )
          .run(activation.id);
        this.db
          .prepare("UPDATE rooms_deliveries SET state='stopped' WHERE id=?")
          .run(activation.delivery_id);
        this.abortStreams(activation.id);
      }
      if (uncertain.length) {
        this.db
          .prepare(
            "UPDATE rooms_agents SET epoch=epoch+1,status='idle' WHERE id=?",
          )
          .run(agentId);
        this.touch(agent.roomId);
      }
      return this.agent(agentId);
    });
  }
  recoverActivations() {
    return this.transaction(() => {
      const active = this.db
        .prepare(
          `SELECT ${activationColumns} FROM rooms_activations WHERE state IN ('dispatching','running')`,
        )
        .all()
        .map((r) => storedActivation.parse(r));
      for (const a of active)
        if (a.state === "dispatching") {
          this.db
            .prepare(
              "UPDATE rooms_activations SET state='uncertain',revoked=1 WHERE id=?",
            )
            .run(a.id);
          this.db
            .prepare(
              "UPDATE rooms_deliveries SET state='uncertain',error=? WHERE id=?",
            )
            .run(
              "The provider may have accepted this request before restart. Review the private agent session before retrying.",
              a.deliveryId,
            );
          this.db
            .prepare("UPDATE rooms_agents SET status='uncertain' WHERE id=?")
            .run(a.agentId);
          this.abortStreams(a.id);
          this.touch(a.roomId);
        }
      return active.map((a) => this.activation(a.id));
    });
  }
  private abortStreams(activationId: string) {
    this.db
      .prepare(
        "UPDATE rooms_messages SET status='stopped' WHERE id IN (SELECT message_id FROM rooms_streams WHERE activation_id=? AND state='open')",
      )
      .run(activationId);
    this.db
      .prepare(
        "UPDATE rooms_streams SET state='aborted' WHERE activation_id=? AND state='open'",
      )
      .run(activationId);
  }
  snapshot(roomId: string) {
    return {
      room: this.room(roomId),
      members: this.members(roomId),
      agents: this.agents(roomId),
      messages: this.messages(roomId),
      deliveries: this.deliveries(roomId),
      online: [] as string[],
    };
  }
  agentCommand(raw: string, command: AgentCommand): AgentCommandResult {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT ${activationColumns} FROM rooms_activations WHERE capability_hash=?`,
        )
        .get(hash(raw));
      if (!row) throw new RoomError(401, "Unknown activation capability");
      const a = storedActivation.parse(row),
        agent = this.agent(a.agentId);
      if (agent.roomId !== a.roomId)
        throw new RoomError(403, "Agent is no longer a room member");
      const epoch = z
        .object({ epoch: z.number() })
        .parse(
          this.db
            .prepare("SELECT epoch FROM rooms_agents WHERE id=?")
            .get(agent.id),
        ).epoch;
      const payload = canonical(command),
        old = this.receipt(a.id, command.requestId, payload);
      if (command.operation === "settle" && old && a.epoch === epoch)
        return agentCommandResultSchema.parse(old);
      if (
        a.revoked ||
        a.epoch !== epoch ||
        !["dispatching", "running"].includes(a.state)
      )
        throw new RoomError(403, "Activation capability is no longer active");
      if (old) return agentCommandResultSchema.parse(old);
      let result: AgentCommandResult;
      const cause = this.delivery(a.deliveryId).messageId;
      switch (command.operation) {
        case "read":
          result = {
            activation: a,
            snapshot: this.snapshot(a.roomId),
            inbox: this.db
              .prepare(
                `SELECT ${deliveryColumns} FROM rooms_deliveries WHERE agent_id=? AND state IN ('queued','dispatching','running') ORDER BY seq`,
              )
              .all(a.agentId)
              .map((r) => deliverySchema.parse(r)),
          };
          break;
        case "post":
        case "request": {
          const input: Publication =
            command.operation === "request"
              ? { ...command.args, intent: "request" }
              : command.args;
          result = {
            message: this.publish(
              { id: agent.id, name: agent.name, kind: "agent" },
              a.roomId,
              input,
              a.id,
              cause,
            ),
            duplicate: false,
          };
          break;
        }
        case "stream.begin": {
          const messageId = id();
          this.insertMessage(
            {
              id: messageId,
              roomId: a.roomId,
              authorId: agent.id,
              authorName: agent.name,
              kind: "agent",
              text: "",
              status: "streaming",
              createdAt: Date.now(),
              causeId: cause,
              intent: "post",
              recipients: [],
              replyTo: null,
            },
            a.id,
          );
          this.db
            .prepare(
              "INSERT INTO rooms_streams(message_id,activation_id,state) VALUES(?,?,'open')",
            )
            .run(messageId, a.id);
          result = { messageId };
          break;
        }
        case "stream.append":
        case "stream.commit":
        case "stream.abort": {
          const input = command.args,
            rawStream = this.db
              .prepare("SELECT * FROM rooms_streams WHERE message_id=?")
              .get(input.messageId);
          if (!rawStream) throw new RoomError(404, "Stream not found");
          const stream = streamSchema.parse(rawStream);
          if (stream.activation_id !== a.id)
            throw new RoomError(403, "Stream belongs to another activation");
          if (
            command.operation === "stream.commit" &&
            stream.state === "committed"
          ) {
            if (stream.commit_payload !== canonical(command.args))
              throw new RoomError(
                409,
                "Stream already committed with different recipients or intent",
              );
            result = {
              message: this.message(stream.message_id),
              duplicate: true,
            };
            break;
          }
          if (stream.state !== "open")
            throw new RoomError(409, "Stream is terminal");
          if (command.operation === "stream.append") {
            const chunk = command.args;
            if (chunk.sequence < stream.next_sequence) {
              const prev = z
                .object({ text: z.string() })
                .parse(
                  this.db
                    .prepare(
                      "SELECT text FROM rooms_chunks WHERE message_id=? AND sequence=?",
                    )
                    .get(chunk.messageId, chunk.sequence),
                );
              if (prev.text !== chunk.text)
                throw new RoomError(
                  409,
                  "Chunk sequence already has different content",
                );
            } else {
              if (chunk.sequence !== stream.next_sequence)
                throw new RoomError(409, "Chunk sequence gap");
              if (
                this.message(chunk.messageId).text.length + chunk.text.length >
                16000
              )
                throw new RoomError(400, "Public message is too long");
              this.db
                .prepare("INSERT INTO rooms_chunks VALUES(?,?,?)")
                .run(chunk.messageId, chunk.sequence, chunk.text);
              this.db
                .prepare(
                  "UPDATE rooms_streams SET next_sequence=next_sequence+1 WHERE message_id=?",
                )
                .run(chunk.messageId);
              this.db
                .prepare("UPDATE rooms_messages SET text=text||? WHERE id=?")
                .run(chunk.text, chunk.messageId);
              this.touch(a.roomId);
            }
            result = { messageId: chunk.messageId, sequence: chunk.sequence };
          } else if (command.operation === "stream.abort") {
            this.db
              .prepare(
                "UPDATE rooms_streams SET state='aborted' WHERE message_id=?",
              )
              .run(input.messageId);
            this.db
              .prepare("UPDATE rooms_messages SET status='stopped' WHERE id=?")
              .run(input.messageId);
            this.touch(a.roomId);
            result = { messageId: input.messageId };
          } else {
            const publication = {
              ...command.args,
              text: this.message(input.messageId).text,
            };
            if (!publication.text.trim())
              throw new RoomError(400, "Cannot publish an empty stream");
            this.validatePublication(a.roomId, publication, agent.id);
            this.db
              .prepare(
                "UPDATE rooms_streams SET state='committed',commit_payload=? WHERE message_id=?",
              )
              .run(canonical(command.args), input.messageId);
            this.db
              .prepare(
                "UPDATE rooms_messages SET status='complete',intent=?,recipients=?,reply_to=? WHERE id=?",
              )
              .run(
                publication.intent,
                JSON.stringify(publication.recipients),
                publication.replyTo,
                input.messageId,
              );
            const message = this.message(input.messageId);
            if (publication.intent !== "post")
              for (const target of publication.recipients)
                if (
                  this.db
                    .prepare(
                      "SELECT id FROM rooms_agents WHERE id=? AND room_id=?",
                    )
                    .get(target, a.roomId)
                )
                  this.enqueue(target, message);
            this.touch(a.roomId);
            result = { message, duplicate: false };
          }
          break;
        }
        case "settle": {
          const published = this.activationPublications(a.id) > 0;
          if ((command.args.outcome === "replied") !== published)
            throw new RoomError(
              409,
              "Settlement must match explicit public messages",
            );
          this.db
            .prepare(
              "UPDATE rooms_activations SET revoked=1,requested_outcome=? WHERE id=?",
            )
            .run(command.args.outcome, a.id);
          this.abortStreams(a.id);
          this.touch(a.roomId);
          result = { outcome: command.args.outcome };
          break;
        }
      }
      this.remember(a.id, command.requestId, payload, result);
      return result;
    });
  }
  close() {
    this.db.close();
  }
}
