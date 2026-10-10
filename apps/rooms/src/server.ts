import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomsStore } from "./store.js";
import { RoomRuntime } from "./runtime.js";
import { createRoomsApp } from "./app.js";
import { NativeRoomsAccess } from "./native-access.js";
const data = process.env.ROOMS_DATA_DIR;
if (!data) throw new Error("ROOMS_DATA_DIR is required");
const origin = process.env.ROOMS_PUBLIC_ORIGIN;
if (!origin) throw new Error("ROOMS_PUBLIC_ORIGIN is required");
const port = Number(process.env.ROOMS_PORT ?? 38900);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("ROOMS_PORT must be a valid TCP port");
mkdirSync(data, { recursive: true, mode: 0o700 });
const store = new RoomsStore(join(data, "rooms.sqlite"));
const runtime = new RoomRuntime(
  store,
  process.env.ROOMS_BB_URL ?? "http://127.0.0.1:38886",
  join(data, "workspaces"),
  process.env.ROOMS_AGENT_ORIGIN ?? `http://127.0.0.1:${port}`,
  process.env.ROOMS_LOCAL_HOST_ID ?? null,
);
if (!existsSync(join(data, "initialized"))) {
  const room = store.createRoom("Workshop", "");
  writeFileSync(join(data, "owner-invite"), store.invite(room.id, "owner"), {
    mode: 0o600,
  });
  writeFileSync(join(data, "initialized"), room.id, { mode: 0o600 });
}
const nativeAppDir = process.env.ROOMS_NATIVE_APP_DIR;
if (nativeAppDir && !isAbsolute(nativeAppDir))
  throw new Error("ROOMS_NATIVE_APP_DIR must be an absolute build directory");
const nativeAccess = nativeAppDir
  ? new NativeRoomsAccess(store, {
      upstreamUrl: process.env.ROOMS_BB_URL ?? "http://127.0.0.1:38886",
      operatorUserIds: (process.env.ROOMS_OPERATOR_USER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      origins: origin.split(","),
    })
  : undefined;
const web =
  nativeAppDir ?? join(dirname(fileURLToPath(import.meta.url)), "web");
if (!existsSync(join(web, "index.html")))
  throw new Error("The configured BB frontend build is missing index.html");
const app = createRoomsApp(store, runtime, origin, { nativeAccess });
app.get("*", serveStatic({ root: web }));
app.get("/assets/*", (c) => c.notFound());
app.get(
  "*",
  serveStatic({
    path: join(web, "index.html"),
  }),
);
runtime.start();
const server = serve(
  {
    fetch: app.fetch,
    hostname: process.env.ROOMS_BIND_HOST ?? "0.0.0.0",
    port,
  },
  () =>
    console.log(
      "BB Rooms listening; owner invitation is in the private data directory",
    ),
);
nativeAccess?.attachWebSockets(server);
process.on("SIGTERM", () => {
  runtime.close();
  nativeAccess?.close();
  server.close(() => {
    store.close();
    process.exit(0);
  });
});
