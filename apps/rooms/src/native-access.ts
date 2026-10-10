import { Server, type IncomingMessage } from "node:http";
import type { ServerType } from "@hono/node-server";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { RoomsStore, RoomError } from "./store.js";

interface NativeRoomsAccessOptions {
  upstreamUrl: string;
  operatorUserIds: readonly string[];
  origins: readonly string[];
}

function sessionToken(headers: Headers) {
  const authorization = headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  for (const cookie of (headers.get("cookie") ?? "").split(";")) {
    const value = cookie.trim();
    if (value.startsWith("rooms_session=")) return value.slice(14);
  }
  return "";
}

function upstreamHeaders(headers: Headers, origin: string) {
  const result = new Headers(headers);
  const connectionHeaders = (result.get("connection") ?? "").split(",");
  for (const name of [
    ...connectionHeaders,
    "authorization",
    "host",
    "origin",
    "forwarded",
    "connection",
    "upgrade",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "proxy-authorization",
    "proxy-authenticate",
    "accept-encoding",
  ])
    if (name.trim()) result.delete(name.trim());
  for (const name of [...result.keys()]) {
    if (
      name.startsWith("x-forwarded-") ||
      name.startsWith("x-bb-gate-") ||
      name.startsWith("x-bb-tunnel-") ||
      name.startsWith("x-bb-relay") ||
      name === "x-bb-cloud-dev-host" ||
      name === "x-bb-connect-machine" ||
      name.startsWith("sec-websocket-")
    )
      result.delete(name);
  }
  const cookies = (result.get("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith("rooms_session="));
  if (cookies.length) result.set("cookie", cookies.join("; "));
  else result.delete("cookie");
  result.set("origin", origin);
  return result;
}

function websocketPath(path: string) {
  return (
    path === "/ws" ||
    /^\/ws\/terminals\/[^/]+$/u.test(path) ||
    /^\/api\/v1\/plugins\/[^/]+\/http(?:\/|$)/u.test(path)
  );
}

function machineHttpKind(method: string, path: string) {
  if (method === "GET") {
    if (["/health", "/install/version", "/install/bb-app.tgz"].includes(path))
      return "public";
    if (["/install.sh", "/install.ps1"].includes(path)) return "bootstrap";
    if (
      path === "/internal/session/project-attachment-content" ||
      /^\/internal\/skills\/tree\/[a-f0-9]{64}$/u.test(path) ||
      /^\/internal\/plugins\/[^/]+\/host\/[a-f0-9]{64}$/u.test(path) ||
      /^\/internal\/server-move\/[^/]+\/(?:archive|bb-app\.tgz)$/u.test(path)
    )
      return "daemon";
  }
  if (
    method === "POST" &&
    [
      "/internal/hosts/enroll",
      "/internal/session/open",
      "/internal/session/events",
      "/internal/session/tool-call",
      "/internal/session/interactive-request",
      "/internal/session/interactive-request/interrupt",
    ].includes(path)
  )
    return "daemon";
  return null;
}

function machineHeaders(headers: Headers, origin: string, bearer = true) {
  const result = upstreamHeaders(headers, origin);
  result.delete("cookie");
  const authorization = headers.get("authorization");
  if (bearer && authorization) result.set("authorization", authorization);
  return result;
}

function requireMachineCredential(headers: Headers) {
  if (!/^Bearer \S+$/u.test(headers.get("authorization") ?? ""))
    throw new RoomError(401, "A BB machine credential is required");
}

export class NativeRoomsAccess {
  private readonly upstream: URL;
  private readonly operators: Set<string>;
  private readonly origins: Set<string>;
  private readonly sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024 * 1024,
  });
  private readonly connections = new Set<() => void>();
  private readonly detach = new Set<() => void>();

  constructor(
    private readonly store: RoomsStore,
    options: NativeRoomsAccessOptions,
  ) {
    this.upstream = new URL(options.upstreamUrl);
    if (
      this.upstream.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(this.upstream.hostname) ||
      this.upstream.username ||
      this.upstream.password ||
      this.upstream.pathname !== "/" ||
      this.upstream.search ||
      this.upstream.hash
    )
      throw new Error(
        "Native BB upstream must be a private loopback HTTP origin",
      );
    this.operators = new Set(options.operatorUserIds);
    if (!this.operators.size)
      throw new Error("Native BB requires explicit operator user IDs");
    for (const id of this.operators) {
      if (!store.db.prepare("SELECT id FROM rooms_users WHERE id=?").get(id))
        throw new Error("A configured native BB operator user does not exist");
    }
    this.origins = new Set(
      options.origins.map((origin) => new URL(origin).origin),
    );
  }

  isOperator(userId: string) {
    return this.operators.has(userId);
  }

  requireOperator(userId: string) {
    if (!this.isOperator(userId))
      throw new RoomError(403, "BB operator access is required");
  }

  session(headers: Headers) {
    const token = sessionToken(headers);
    if (!token)
      return { enabled: true, user: null, access: { operator: false } };
    try {
      const user = this.store.authenticate(token);
      return {
        enabled: true,
        user,
        access: { operator: this.isOperator(user.id) },
      };
    } catch (error) {
      if (error instanceof RoomError && error.status === 401)
        return { enabled: true, user: null, access: { operator: false } };
      throw error;
    }
  }

  private authorize(headers: Headers, mutating: boolean) {
    const token = sessionToken(headers);
    const user = this.store.authenticate(token);
    this.requireOperator(user.id);
    const origin = headers.get("origin");
    if (origin && !this.origins.has(origin))
      throw new RoomError(403, "Origin is not allowed");
    if (
      !origin &&
      mutating &&
      !headers.get("authorization")?.startsWith("Bearer ")
    )
      throw new RoomError(403, "An authenticated browser origin is required");
    return token;
  }

  async proxyHttp(request: Request) {
    this.authorize(
      request.headers,
      !["GET", "HEAD", "OPTIONS"].includes(request.method),
    );
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith("/api/v1/"))
      throw new RoomError(403, "Native endpoint is not available");
    if (
      request.method === "POST" &&
      /^\/api\/v1\/server\/move(?:\/check)?\/?$/u.test(incoming.pathname)
    )
      throw new RoomError(
        409,
        "Moving this server is unavailable while Rooms uses a separate data directory and service. BB's move would leave room history, identities and the gateway behind. Combined BB and Rooms migration is not implemented in this preview.",
      );
    return this.forwardHttp(
      request,
      upstreamHeaders(request.headers, this.upstream.origin),
    );
  }

  async proxyMachineHttp(request: Request) {
    const kind = machineHttpKind(request.method, new URL(request.url).pathname);
    if (kind === null)
      throw new RoomError(403, "Machine endpoint is not available");
    if (kind === "bootstrap" && !request.headers.get("x-bb-enrollment")?.trim())
      throw new RoomError(403, "A BB enrollment command is required");
    if (kind === "daemon") requireMachineCredential(request.headers);
    return this.forwardHttp(
      request,
      machineHeaders(request.headers, this.upstream.origin, kind === "daemon"),
    );
  }

  private async forwardHttp(request: Request, headers: Headers) {
    const incoming = new URL(request.url);
    const target = new URL(this.upstream);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const init: RequestInit & { duplex: "half" } = {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
      signal: request.signal,
      duplex: "half",
    };
    const response = await fetch(target, init);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.set("cache-control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }

  attachWebSockets(server: ServerType) {
    if (!(server instanceof Server))
      throw new Error("Native BB sockets require an HTTP/1.1 server");
    const upgrade = (
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => {
      const reject = (status: number) => {
        if (!socket.destroyed)
          socket.end(
            `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Bad Gateway"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
          );
      };
      try {
        const incoming = new URL(request.url ?? "/", this.upstream);
        const machine = incoming.pathname === "/internal/ws";
        if (!machine && !websocketPath(incoming.pathname))
          throw new RoomError(403, "Native socket is not available");
        const headers = new Headers();
        for (let i = 0; i < request.rawHeaders.length; i += 2)
          headers.append(request.rawHeaders[i], request.rawHeaders[i + 1]);
        if (machine && !headers.has("authorization"))
          throw new RoomError(403, "A BB machine credential is required");
        if (machine) requireMachineCredential(headers);
        const token = machine ? null : this.authorize(headers, true);
        const authorize = () => {
          if (token !== null)
            this.requireOperator(this.store.authenticate(token).id);
        };
        const target = new URL(this.upstream);
        target.protocol = "ws:";
        target.pathname = incoming.pathname;
        target.search = incoming.search;
        const protocols = (headers.get("sec-websocket-protocol") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const upstream = new WebSocket(target, protocols, {
          headers: Object.fromEntries(
            machine
              ? machineHeaders(headers, this.upstream.origin)
              : upstreamHeaders(headers, this.upstream.origin),
          ),
          handshakeTimeout: 10000,
          maxPayload: 32 * 1024 * 1024,
        });
        let browser: WebSocket | null = null;
        let interval: ReturnType<typeof setInterval> | null = null;
        const close = () => {
          if (interval) clearInterval(interval);
          interval = null;
          this.connections.delete(close);
          if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
          if (browser && browser.readyState !== WebSocket.CLOSED)
            browser.terminate();
          if (!browser && !socket.destroyed) socket.destroy();
        };
        this.connections.add(close);
        socket.once("close", close);
        upstream.once("error", () => {
          if (!browser) reject(502);
          close();
        });
        upstream.once("unexpected-response", (_request, response) => {
          response.resume();
          reject(
            response.statusCode === 401 || response.statusCode === 403
              ? response.statusCode
              : 502,
          );
          close();
        });
        upstream.once("close", close);
        upstream.once("open", () => {
          try {
            authorize();
            if (upstream.protocol)
              request.headers["sec-websocket-protocol"] = upstream.protocol;
            else delete request.headers["sec-websocket-protocol"];
            this.sockets.handleUpgrade(request, socket, head, (downstream) => {
              browser = downstream;
              downstream.on("message", (data, binary) => {
                try {
                  authorize();
                  if (upstream.readyState === WebSocket.OPEN)
                    upstream.send(data, { binary });
                } catch {
                  close();
                }
              });
              upstream.on("message", (data, binary) => {
                try {
                  authorize();
                  if (downstream.readyState === WebSocket.OPEN)
                    downstream.send(data, { binary });
                } catch {
                  close();
                }
              });
              downstream.once("error", close);
              downstream.once("close", close);
              if (!machine) {
                interval = setInterval(() => {
                  try {
                    authorize();
                  } catch {
                    close();
                  }
                }, 500);
                interval.unref();
              }
            });
          } catch {
            reject(401);
            close();
          }
        });
      } catch (error) {
        reject(error instanceof RoomError ? error.status : 502);
      }
    };
    server.on("upgrade", upgrade);
    this.detach.add(() => server.off("upgrade", upgrade));
  }

  close() {
    for (const close of this.connections) close();
    for (const detach of this.detach) detach();
    this.detach.clear();
    this.sockets.close();
  }
}
