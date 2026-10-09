import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomsStore } from "./store.js";
import { RoomRuntime } from "./runtime.js";
import { createRoomsApp } from "./app.js";
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
);
if (!existsSync(join(data, "initialized"))) {
  const room = store.createRoom("Workshop", "");
  writeFileSync(join(data, "owner-invite"), store.invite(room.id, "owner"), {
    mode: 0o600,
  });
  writeFileSync(join(data, "initialized"), room.id, { mode: 0o600 });
}
const app = createRoomsApp(store, runtime, origin);
app.get(
  "*",
  serveStatic({ root: join(dirname(fileURLToPath(import.meta.url)), "web") }),
);
app.get(
  "*",
  serveStatic({
    path: join(dirname(fileURLToPath(import.meta.url)), "web/index.html"),
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
process.on("SIGTERM", () => {
  runtime.close();
  server.close(() => {
    store.close();
    process.exit(0);
  });
});
