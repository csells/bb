import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { pendingInteractionResolutionSchema } from "@bb/domain";
import { RoomsStore, RoomError, id } from "./store.js";
import { RoomRuntime } from "./runtime.js";
import {
  createAgentSchema,
  handle,
  messageInputSchema,
  type User,
} from "./contracts.js";
import { recipients } from "./routing.js";
export function createRoomsApp(
  store: RoomsStore,
  runtime: RoomRuntime,
  origin: string,
) {
  const app = new Hono<{ Variables: { user: User } }>();
  const pollOnline = new Map<string, Map<string, number>>();
  const allowedOrigins = new Set(origin.split(","));
  const online = new Map<string, Map<string, number>>();
  const attempts = new Map<string, { count: number; reset: number }>();
  app.use("*", bodyLimit({ maxSize: 65536 }));
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    if (!["GET", "HEAD"].includes(c.req.method)) {
      if (c.req.header("X-Rooms-Request") !== "1")
        throw new RoomError(403, "Missing request protection");
      const supplied = c.req.header("Origin");
      if (supplied && !allowedOrigins.has(supplied))
        throw new RoomError(403, "Origin is not allowed");
    }
    await next();
  });
  app.onError((e, c) => {
    if (e instanceof RoomError)
      return c.json(
        { error: e.message },
        e.status as 400 | 401 | 403 | 404 | 409 | 429,
      );
    if (e instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
    if (e instanceof z.ZodError)
      return c.json(
        {
          error: "Invalid request",
          issues: e.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    console.error("Rooms request failed", e);
    return c.json({ error: "The request could not be completed" }, 500);
  });
  const signIn = (c: Parameters<typeof getCookie>[0], user: User) =>
    setCookie(c, "rooms_session", store.session(user.id), {
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "Strict",
      path: "/",
      maxAge: 7 * 86400,
    });
  app.get("/health", (c) => c.json({ ok: true, service: "bb-rooms" }));
  app.use("/api/auth/*", async (c, next) => {
    const key = "gateway";
    let bucket = attempts.get(key);
    if (!bucket || bucket.reset < Date.now()) {
      bucket = { count: 0, reset: Date.now() + 60000 };
      attempts.set(key, bucket);
    }
    if (++bucket.count > 30)
      throw new RoomError(429, "Too many sign-in attempts; wait a minute");
    await next();
  });
  app.post("/api/auth/register", async (c) => {
    const b = z
      .object({
        invite: z.string().min(20),
        handle,
        name: z.string().trim().min(1).max(80),
        password: z.string().min(12).max(128),
      })
      .strict()
      .parse(await c.req.json());
    const u = store.register(b.invite, b.handle, b.name, b.password);
    signIn(c, u);
    return c.json({ user: u });
  });
  app.post("/api/auth/token", async (c) => {
    const b = z
      .object({ handle, password: z.string().max(128) })
      .strict()
      .parse(await c.req.json());
    const u = store.login(b.handle, b.password);
    return c.json({ user: u, token: store.session(u.id) });
  });
  app.post("/api/auth/login", async (c) => {
    const b = z
      .object({ handle, password: z.string().max(128) })
      .strict()
      .parse(await c.req.json());
    const u = store.login(b.handle, b.password);
    signIn(c, u);
    return c.json({ user: u });
  });
  app.use("/api/*", async (c, next) => {
    const bearer = c.req.header("Authorization");
    const raw = bearer?.startsWith("Bearer ")
      ? bearer.slice(7)
      : (getCookie(c, "rooms_session") ?? "");
    c.set("user", store.authenticate(raw));
    await next();
  });
  app.get("/api/me", (c) =>
    c.json({ user: c.get("user"), rooms: store.rooms(c.get("user").id) }),
  );
  app.post("/api/logout", (c) => {
    store.logout(
      c.req.header("Authorization")?.replace(/^Bearer /, "") ??
        getCookie(c, "rooms_session") ??
        "",
    );
    deleteCookie(c, "rooms_session", { path: "/" });
    return c.json({ ok: true });
  });
  app.post("/api/join", async (c) => {
    const b = z
      .object({ invite: z.string().min(20) })
      .strict()
      .parse(await c.req.json());
    return c.json(store.acceptInvite(b.invite, c.get("user")));
  });
  app.post("/api/rooms", async (c) => {
    const b = z
      .object({ name: z.string().trim().min(1).max(100) })
      .strict()
      .parse(await c.req.json());
    return c.json(store.createRoom(b.name, c.get("user").id));
  });
  app.use("/api/rooms/:roomId/*", async (c, next) => {
    store.membership(c.req.param("roomId")!, c.get("user").id);
    await next();
  });
  const snapshot = (roomId: string) => ({
    room: store.room(roomId),
    members: store.members(roomId),
    agents: store.agents(roomId),
    messages: store.messages(roomId),
    deliveries: store.deliveries(roomId),
    online: [
      ...new Set([
        ...(online.get(roomId)?.keys() ?? []),
        ...[...(pollOnline.get(roomId) ?? [])]
          .filter(([, until]) => until > Date.now())
          .map(([id]) => id),
      ]),
    ],
  });
  app.get("/api/rooms/:roomId", (c) => {
    const roomId = c.req.param("roomId");
    store.membership(roomId, c.get("user").id);
    return c.json(snapshot(roomId));
  });
  app.get("/api/rooms/:roomId/poll", (c) => {
    const roomId = c.req.param("roomId"),
      user = c.get("user");
    const presence = pollOnline.get(roomId) ?? new Map<string, number>();
    pollOnline.set(roomId, presence);
    presence.set(user.id, Date.now() + 5000);
    return c.json(snapshot(roomId));
  });
  app.get("/api/rooms/:roomId/events", (c) => {
    const roomId = c.req.param("roomId"),
      user = c.get("user");
    const presence = online.get(roomId) ?? new Map<string, number>();
    online.set(roomId, presence);
    presence.set(user.id, (presence.get(user.id) ?? 0) + 1);
    store.touch(roomId);
    const raw =
      getCookie(c, "rooms_session") ??
      (c.req.header("Authorization") ?? "").replace(/^Bearer /, "");
    return streamSSE(c, async (stream) => {
      let revision = -1;
      try {
        while (!stream.aborted) {
          store.authenticate(raw);
          store.membership(roomId, user.id);
          const room = store.room(roomId);
          if (room.revision !== revision) {
            revision = room.revision;
            await stream.writeSSE({
              event: "snapshot",
              id: String(revision),
              data: JSON.stringify(snapshot(roomId)),
            });
          }
          await stream.sleep(500);
        }
      } catch (e) {
        if (!stream.aborted)
          await stream.writeSSE({
            event: "access-error",
            data: JSON.stringify({
              error: e instanceof Error ? e.message : "Connection closed",
            }),
          });
      } finally {
        const n = (presence.get(user.id) ?? 1) - 1;
        if (n) presence.set(user.id, n);
        else presence.delete(user.id);
        store.touch(roomId);
      }
    });
  });
  app.post("/api/rooms/:roomId/invites", (c) => {
    const roomId = c.req.param("roomId");
    store.membership(roomId, c.get("user").id, true);
    return c.json({ invite: store.invite(roomId) });
  });
  app.delete("/api/rooms/:roomId/members/:userId", (c) => {
    const roomId = c.req.param("roomId");
    store.membership(roomId, c.get("user").id, true);
    store.removeMember(roomId, c.req.param("userId"));
    return c.json({ ok: true });
  });
  app.post("/api/rooms/:roomId/agents", async (c) => {
    const roomId = c.req.param("roomId");
    store.membership(roomId, c.get("user").id, true);
    const b = createAgentSchema.parse(await c.req.json());
    return c.json(store.addAgent(roomId, b));
  });
  app.put("/api/rooms/:roomId/default", async (c) => {
    const roomId = c.req.param("roomId");
    store.membership(roomId, c.get("user").id, true);
    const b = z
      .object({ agentId: z.string().nullable() })
      .strict()
      .parse(await c.req.json());
    store.setDefault(roomId, b.agentId);
    return c.json({ ok: true });
  });
  app.post("/api/rooms/:roomId/messages", async (c) => {
    const roomId = c.req.param("roomId");
    const b = messageInputSchema.parse(await c.req.json());
    const agents = store.agents(roomId);
    const targets = b.recipients.length
      ? [...new Set(b.recipients)]
      : recipients(b.text, agents, store.room(roomId).defaultAgentId);
    if (targets.some((t) => !agents.some((a) => a.id === t)))
      throw new RoomError(400, "Unknown recipient");
    const result = store.transaction(() => {
      const r = store.requestMessage(
        c.get("user"),
        roomId,
        b.text,
        b.requestId,
      );
      if (!r.duplicate) for (const a of targets) store.enqueue(a, r.message);
      return r;
    });
    runtime.tick();
    return c.json(result);
  });
  app.use("/api/rooms/:roomId/agents/:agentId/*", async (c, next) => {
    if (store.agent(c.req.param("agentId")!).roomId !== c.req.param("roomId"))
      throw new RoomError(404, "Agent not found in room");
    await next();
  });
  app.post("/api/rooms/:roomId/agents/:agentId/stop", async (c) => {
    await runtime.stop(c.req.param("agentId"));
    return c.json({ ok: true });
  });
  app.post("/api/rooms/:roomId/agents/:agentId/steer", async (c) => {
    const b = z
      .object({ text: z.string().trim().min(1).max(16000) })
      .strict()
      .parse(await c.req.json());
    const u = c.get("user");
    store.requestMessage(u, c.req.param("roomId"), b.text, id());
    await runtime.steer(
      c.req.param("agentId"),
      `Steering from human ${u.name} (@${u.handle}): ${b.text}`,
    );
    return c.json({ ok: true });
  });
  app.get("/api/rooms/:roomId/agents/:agentId/interactions", async (c) =>
    c.json(await runtime.interactions(c.req.param("agentId"))),
  );
  app.post(
    "/api/rooms/:roomId/agents/:agentId/interactions/:interactionId",
    async (c) => {
      store.membership(c.req.param("roomId"), c.get("user").id, true);
      const a = store.agent(c.req.param("agentId"));
      if (!a.threadId) throw new RoomError(409, "Agent has not started");
      const resolution = pendingInteractionResolutionSchema.parse(
        await c.req.json(),
      );
      return c.json(
        await runtime.sdk.threads.interactions.resolve({
          threadId: a.threadId,
          interactionId: c.req.param("interactionId"),
          resolution,
        }),
      );
    },
  );
  app.get("/api/providers", async (c) =>
    c.json(await runtime.sdk.providers.list()),
  );
  app.all("/api/*", (c) => c.json({ error: "Endpoint not found" }, 404));
  return app;
}
