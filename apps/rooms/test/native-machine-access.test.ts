import { afterEach, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createConnection, migrate } from "@bb/db";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { createMachineAuthService } from "../../server/src/services/machine-auth.js";
import { verifyAuthenticatedDaemon } from "../../server/src/internal/auth.js";
import { RoomsStore } from "../src/store.js";
import { RoomRuntime } from "../src/runtime.js";
import { NativeRoomsAccess } from "../src/native-access.js";
import { createRoomsApp } from "../src/app.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("preserves BB enrollment and machine authentication without granting browser or loopback access", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "rooms-machine-access-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const db = createConnection(":memory:");
  migrate(db);
  cleanups.push(() => {
    db.$client.close();
  });
  const machineAuth = await createMachineAuthService({
    dataDir,
    db,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const enrollment = await machineAuth.issueHostEnrollKey({
    hostId: "host_native",
    enrollSource: "public-multi-machine",
  });
  const received: Array<{ path: string; headers: IncomingHttpHeaders }> = [];
  const upstream = createServer(async (request, response) => {
    received.push({ path: request.url ?? "", headers: request.headers });
    response.setHeader("content-type", "application/json");
    if (request.url === "/health") {
      response.end(JSON.stringify({ ok: true, serverMove: { moveId: "move", state: "ready" } }));
      return;
    }
    if (request.url === "/install.sh") {
      response.statusCode = request.headers["x-bb-enrollment"] === enrollment.key ? 200 : 403;
      response.end("installer");
      return;
    }
    if (request.url === "/install/version") {
      response.end(JSON.stringify({ version: "test" }));
      return;
    }
    if (request.url === "/internal/hosts/enroll") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const payload = z.object({ hostId: z.string() }).parse(JSON.parse(Buffer.concat(chunks).toString()));
      const result = await machineAuth.enrollHost({ hostId: payload.hostId, token: (request.headers.authorization ?? "").replace(/^Bearer /u, "") });
      response.statusCode = result ? 201 : 401;
      response.end(JSON.stringify(result));
      return;
    }
    try {
      const daemon = await verifyAuthenticatedDaemon({ machineAuth }, request.headers.authorization);
      response.end(JSON.stringify({ hostId: daemon.hostId }));
    } catch {
      response.statusCode = 401;
      response.end("{}");
    }
  });
  const sockets = new WebSocketServer({ noServer: true });
  upstream.on("upgrade", async (request, socket, head) => {
    try {
      await verifyAuthenticatedDaemon({ machineAuth }, request.headers.authorization);
      received.push({ path: request.url ?? "", headers: request.headers });
      sockets.handleUpgrade(request, socket, head, (ws) => ws.on("message", (data, binary) => ws.send(data, { binary })));
    } catch {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    }
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    upstream.closeAllConnections();
    return new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const store = new RoomsStore(":memory:");
  cleanups.push(() => store.close());
  const room = store.createRoom("Test", "");
  const owner = store.register(store.invite(room.id, "owner"), "owner", "Owner", "correct horse battery");
  const access = new NativeRoomsAccess(store, { upstreamUrl, operatorUserIds: [owner.id], origins: ["https://bb.example"] });
  const app = createRoomsApp(store, new RoomRuntime(store, upstreamUrl, "/tmp"), "https://bb.example", { nativeAccess: access });
  const edge = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => edge.listening ? resolve() : edge.once("listening", resolve));
  access.attachWebSockets(edge);
  cleanups.push(() => { access.close(); return new Promise<void>((resolve) => edge.close(() => resolve())); });
  const base = `http://127.0.0.1:${(edge.address() as AddressInfo).port}`;
  const ownerToken = store.session(owner.id);
  for (const path of ["/api/v1/server/move", "/api/v1/server/move/check"]) {
    const blocked = await fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${ownerToken}` }, body: "{}" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: expect.stringContaining("leave room history") });
  }
  const enroll = (token: string, hostId = "host_native") => fetch(base + "/internal/hosts/enroll", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ hostId }) });
  expect((await fetch(base + "/install.sh")).status).toBe(403);
  expect((await fetch(base + "/install.sh", { headers: { "x-bb-enrollment": "invalid" } })).status).toBe(403);
  expect((await fetch(base + "/install.sh", { headers: { "x-bb-enrollment": enrollment.key } })).status).toBe(200);
  expect((await fetch(base + "/install/version")).status).toBe(200);
  expect(await (await fetch(base + "/health")).json()).toMatchObject({ serverMove: { moveId: "move", state: "ready" } });
  expect((await enroll("invalid")).status).toBe(401);
  expect((await enroll(ownerToken)).status).toBe(401);
  const wrongHost = await machineAuth.issueHostEnrollKey({ hostId: "host_other", enrollSource: "public-multi-machine" });
  expect((await enroll(wrongHost.key)).status).toBe(401);
  const response = await enroll(enrollment.key);
  expect(response.status).toBe(201);
  const { hostKey } = z.object({ hostKey: z.string() }).parse(await response.json());
  expect((await enroll(enrollment.key)).status).toBe(401);
  const headers = { authorization: `Bearer ${hostKey}`, cookie: `rooms_session=${ownerToken}; unrelated=private`, "x-bb-gate-auth": "session", "x-bb-cloud-dev-host": "forged", "x-forwarded-for": "127.0.0.1" };
  expect((await fetch(base + "/api/v1/projects", { headers })).status).toBe(401);
  for (const path of ["/internal/hosts/enroll-key", "/internal/server-move/pending", "/internal/not-a-route", "/install/private"]) {
    expect((await fetch(base + path, { headers })).status).toBe(403);
  }
  const session = await fetch(base + "/internal/session/open", { method: "POST", headers, body: "{}" });
  expect(session.status).toBe(200);
  expect(await session.json()).toEqual({ hostId: "host_native" });
  const forwarded = received.at(-1)!.headers;
  expect(forwarded.authorization).toBe(`Bearer ${hostKey}`);
  for (const name of ["cookie", "x-bb-gate-auth", "x-bb-cloud-dev-host", "x-forwarded-for"]) expect(forwarded).not.toHaveProperty(name);
  const connect = (token: string) => new WebSocket(base.replace("http:", "ws:") + "/internal/ws?sessionId=fixture", "bb-host-daemon.v1", { headers: { authorization: `Bearer ${token}` } });
  const socket = connect(hostKey);
  cleanups.push(() => socket.terminate());
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const echoed = new Promise<string>((resolve) => socket.once("message", (data) => resolve(data.toString())));
  socket.send("machine frame");
  expect(await echoed).toBe("machine frame");
  socket.terminate();
  await machineAuth.revokeHostAuthKeys({ hostId: "host_native" });
  expect((await fetch(base + "/internal/session/open", { method: "POST", headers, body: "{}" })).status).toBe(401);
  for (const token of [hostKey, ownerToken, "invalid"]) {
    const rejected = connect(token);
    cleanups.push(() => rejected.terminate());
    expect(await new Promise<number | undefined>((resolve, reject) => {
      rejected.once("open", () => reject(new Error("Invalid machine socket opened")));
      rejected.once("error", () => {});
      rejected.once("unexpected-response", (_request, response) => { response.resume(); rejected.terminate(); resolve(response.statusCode); });
    })).toBe(401);
  }
});
