import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import { RoomsStore } from "../src/store.js";
import { RoomRuntime } from "../src/runtime.js";
import { createRoomsApp } from "../src/app.js";
import { NativeRoomsAccess } from "../src/native-access.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function setup() {
  const upstreamRequests: Array<{
    path: string;
    headers: Record<string, string | string[] | undefined>;
    bytes: number;
  }> = [];
  const upstream = createServer(async (request, response) => {
    let bytes = 0;
    for await (const chunk of request) bytes += chunk.length;
    upstreamRequests.push({
      path: request.url!,
      headers: request.headers,
      bytes,
    });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, bytes }));
  });
  const upstreamUrl = await listen(upstream);
  const upstreamSockets = new WebSocketServer({ noServer: true });
  upstream.on("upgrade", (request, socket, head) =>
    upstreamSockets.handleUpgrade(request, socket, head, (ws) => {
      ws.on("message", (data, binary) => ws.send(data, { binary }));
    }),
  );
  cleanups.push(() => {
    for (const socket of upstreamSockets.clients) socket.terminate();
    upstreamSockets.close();
  });
  const store = new RoomsStore(":memory:");
  cleanups.push(() => store.close());
  const room = store.createRoom("Shared", "");
  const owner = store.register(
    store.invite(room.id, "owner"),
    "owner",
    "Owner",
    "correct horse battery",
  );
  const guest = store.register(
    store.invite(room.id),
    "guest",
    "Guest",
    "correct horse battery",
  );
  const guestOwnedRoom = store.createRoom("Guest owned", guest.id);
  const operatorToken = store.session(owner.id);
  const guestToken = store.session(guest.id);
  const access = new NativeRoomsAccess(store, {
    upstreamUrl,
    operatorUserIds: [owner.id],
    origins: ["https://bb.example"],
  });
  cleanups.push(() => access.close());
  const runtime = new RoomRuntime(store, upstreamUrl, "/tmp");
  const app = createRoomsApp(store, runtime, "https://bb.example", {
    nativeAccess: access,
  });
  const edge = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) =>
    edge.listening ? resolve() : edge.once("listening", resolve),
  );
  access.attachWebSockets(edge);
  const baseUrl = `http://127.0.0.1:${(edge.address() as AddressInfo).port}`;
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        access.close();
        edge.close(() => resolve());
      }),
  );
  return {
    store,
    app,
    access,
    baseUrl,
    room,
    guestOwnedRoom,
    owner,
    guest,
    operatorToken,
    guestToken,
    upstreamRequests,
  };
}
async function openSocket(baseUrl: string, path: string, token: string) {
  const socket = new WebSocket(baseUrl.replace("http:", "ws:") + path, {
    origin: "https://bb.example",
    headers: { cookie: `rooms_session=${token}` },
  });
  cleanups.push(() => socket.terminate());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}
async function rejectedSocket(
  baseUrl: string,
  path: string,
  token: string,
  origin = "https://bb.example",
) {
  const socket = new WebSocket(baseUrl.replace("http:", "ws:") + path, {
    origin,
    headers: { cookie: `rooms_session=${token}`, "x-bb-gate-auth": "session" },
  });
  cleanups.push(() => socket.terminate());
  return new Promise<number | undefined>((resolve, reject) => {
    socket.once("open", () => reject(new Error("Unauthorized socket opened")));
    socket.once("error", () => {});
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode);
    });
  });
}
describe("native BB room access", () => {
  it("gates native HTTP independently from room ownership and does not relay room credentials", async () => {
    const h = await setup();
    const operator = { authorization: `Bearer ${h.operatorToken}` };
    const guest = { authorization: `Bearer ${h.guestToken}` };
    expect(
      await (await fetch(h.baseUrl + "/api/v1/rooms/session")).json(),
    ).toEqual({ enabled: true, user: null, access: { operator: false } });
    expect(
      await (
        await fetch(h.baseUrl + "/api/v1/rooms/session", { headers: operator })
      ).json(),
    ).toMatchObject({ user: { id: h.owner.id }, access: { operator: true } });
    expect(
      await (await fetch(h.baseUrl + "/api/me", { headers: guest })).json(),
    ).toMatchObject({ user: { id: h.guest.id }, access: { operator: false } });
    expect(
      (
        await fetch(h.baseUrl + `/api/rooms/${h.guestOwnedRoom.id}`, {
          headers: guest,
        })
      ).status,
    ).toBe(200);
    for (const path of [
      "/api/v1/projects",
      "/api/v1/threads/private/events",
      "/api/v1/terminals",
      "/api/v1/plugins/a/http/private",
    ]) {
      expect((await fetch(h.baseUrl + path)).status).toBe(401);
      expect(
        (
          await fetch(h.baseUrl + path, {
            headers: {
              ...guest,
              "x-bb-gate-auth": "session",
              "x-bb-gate-owner": h.owner.id,
            },
          })
        ).status,
      ).toBe(403);
    }
    for (const path of [
      "/internal/ws",
      "/internal/hosts/enroll",
      "/install.sh",
    ]) {
      expect(
        (await fetch(h.baseUrl + path, { headers: operator })).status,
      ).toBe(403);
    }
    const body = "x".repeat(70000);
    const response = await fetch(h.baseUrl + "/api/v1/projects/upload", {
      method: "POST",
      headers: {
        ...operator,
        "content-type": "application/octet-stream",
        "x-bb-gate-auth": "machine",
        "x-bb-cloud-dev-host": "attacker",
        "x-forwarded-for": "forged",
        cookie: "rooms_session=private; plugin_session=retained",
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, bytes: 70000 });
    expect(h.upstreamRequests).toHaveLength(1);
    expect(h.upstreamRequests[0].headers).not.toHaveProperty("authorization");
    expect(h.upstreamRequests[0].headers).not.toHaveProperty("x-bb-gate-auth");
    expect(h.upstreamRequests[0].headers).not.toHaveProperty(
      "x-bb-cloud-dev-host",
    );
    expect(h.upstreamRequests[0].headers).not.toHaveProperty("x-forwarded-for");
    expect(h.upstreamRequests[0].headers.cookie).toBe(
      "plugin_session=retained",
    );
    for (const headers of [
      new Headers({ cookie: `rooms_session=${h.operatorToken}` }),
      new Headers({ ...operator, origin: "https://evil.example" }),
    ]) {
      expect(
        (
          await fetch(h.baseUrl + "/api/v1/projects", {
            method: "POST",
            headers,
            body: "{}",
          })
        ).status,
      ).toBe(403);
    }
    expect(h.upstreamRequests).toHaveLength(1);
  });
  it("gates every native socket, preserves text and binary frames, and revokes live sockets at logout and expiry", async () => {
    const h = await setup();
    const paths = [
      "/ws",
      "/ws/terminals/private-terminal",
      "/api/v1/plugins/example/http/live",
    ];
    for (const path of paths) {
      expect(await rejectedSocket(h.baseUrl, path, "")).toBe(401);
      expect(await rejectedSocket(h.baseUrl, path, h.guestToken)).toBe(403);
      expect(
        await rejectedSocket(
          h.baseUrl,
          path,
          h.operatorToken,
          "https://evil.example",
        ),
      ).toBe(403);
    }
    expect(
      await rejectedSocket(h.baseUrl, "/internal/ws", h.operatorToken),
    ).toBe(403);
    const sockets = [];
    for (const path of paths) {
      const socket = await openSocket(h.baseUrl, path, h.operatorToken);
      const frame = new Promise<{ text: string; binary: boolean }>((resolve) =>
        socket.once("message", (data, binary) =>
          resolve({ text: data.toString(), binary }),
        ),
      );
      socket.send("native frame", { binary: path !== "/ws" });
      expect(await frame).toEqual({
        text: "native frame",
        binary: path !== "/ws",
      });
      sockets.push(socket);
    }
    const closed = Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => socket.once("close", () => resolve())),
      ),
    );
    const logout = await fetch(h.baseUrl + "/api/logout", {
      method: "POST",
      headers: {
        authorization: `Bearer ${h.operatorToken}`,
        "x-rooms-request": "1",
      },
    });
    expect(logout.status).toBe(200);
    await closed;
    expect(
      (
        await fetch(h.baseUrl + "/api/v1/projects", {
          headers: { authorization: `Bearer ${h.operatorToken}` },
        })
      ).status,
    ).toBe(401);
    const expiringToken = h.store.session(h.owner.id);
    const expiring = await openSocket(h.baseUrl, "/ws", expiringToken);
    const expired = new Promise<void>((resolve) =>
      expiring.once("close", () => resolve()),
    );
    h.store.db
      .prepare("UPDATE rooms_sessions SET expires=0 WHERE user_id=?")
      .run(h.owner.id);
    await expired;
  });
  it("allows independent room speech but rejects execution grants and revokes live room membership", async () => {
    const h = await setup();
    const guestHeaders = {
      authorization: `Bearer ${h.guestToken}`,
      "content-type": "application/json",
      "x-rooms-request": "1",
    };
    const operatorHeaders = {
      authorization: `Bearer ${h.operatorToken}`,
      "content-type": "application/json",
      "x-rooms-request": "1",
    };
    const agent = h.store.addAgent(h.guestOwnedRoom.id, {
      handle: "worker",
      name: "Worker",
      provider: "pi",
      model: "test",
      instructions: "",
    });
    for (const [method, path, body] of [
      [
        "POST",
        `/api/rooms/${h.guestOwnedRoom.id}/agents`,
        { handle: "other", name: "Other", threadId: "private" },
      ],
      [
        "PUT",
        `/api/rooms/${h.guestOwnedRoom.id}/context`,
        { projectId: "private", defaultEnvironmentId: null, sectionId: null },
      ],
      ["POST", "/api/rooms", { name: "Escalation", projectId: "private" }],
      ["GET", "/api/providers", null],
      ...["activity", "interactions", "recover", "stop", "steer"].map(
        (operation): [string, string, { text: string } | null] => [
          operation === "activity" || operation === "interactions"
            ? "GET"
            : "POST",
          `/api/rooms/${h.guestOwnedRoom.id}/agents/${agent.id}/${operation}`,
          operation === "steer" ? { text: "forged control" } : null,
        ],
      ),
    ] as const) {
      const response = await fetch(h.baseUrl + path, {
        method,
        headers: guestHeaders,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    for (const [headers, author, text] of [
      [operatorHeaders, h.owner.id, "Owner speaking"],
      [guestHeaders, h.guest.id, "Guest speaking"],
    ] as const) {
      const response = await fetch(
        h.baseUrl + `/api/rooms/${h.room.id}/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            text,
            intent: "post",
            recipients: [],
            requestId: crypto.randomUUID(),
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        message: { authorId: author, text },
      });
    }
    const forged = await fetch(h.baseUrl + `/api/rooms/${h.room.id}/messages`, {
      method: "POST",
      headers: guestHeaders,
      body: JSON.stringify({
        text: "Forged",
        recipients: [],
        requestId: crypto.randomUUID(),
        authorId: h.owner.id,
      }),
    });
    expect(forged.status).toBe(400);
    const events = await fetch(h.baseUrl + `/api/rooms/${h.room.id}/events`, {
      headers: guestHeaders,
    });
    const reader = events.body!.getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        "event: snapshot",
      );
      expect(
        (
          await fetch(
            h.baseUrl + `/api/rooms/${h.room.id}/members/${h.guest.id}`,
            { method: "DELETE", headers: operatorHeaders },
          )
        ).status,
      ).toBe(200);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        "event: access-error",
      );
      expect(
        (
          await fetch(h.baseUrl + `/api/rooms/${h.room.id}/messages`, {
            method: "POST",
            headers: guestHeaders,
            body: JSON.stringify({
              text: "After revocation",
              recipients: [],
              requestId: crypto.randomUUID(),
            }),
          })
        ).status,
      ).toBe(403);
    } finally {
      await reader.cancel();
    }
  });
});
