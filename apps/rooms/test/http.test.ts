import { describe, it, expect, afterEach } from "vitest";
import { RoomsStore } from "../src/store.js";
import { RoomRuntime } from "../src/runtime.js";
import { createRoomsApp } from "../src/app.js";
const stores: RoomsStore[] = [];
function setup() {
  const store = new RoomsStore(":memory:");
  stores.push(store);
  const room = store.createRoom("Private", "");
  const owner = store.register(
    store.invite(room.id, "owner"),
    "owner",
    "Owner",
    "correct horse battery",
  );
  const other = store.createRoom("Other", "");
  const stranger = store.register(
    store.invite(other.id, "owner"),
    "other",
    "Other",
    "correct horse battery",
  );
  const runtime = new RoomRuntime(store, "http://127.0.0.1:1", "/tmp");
  return {
    store,
    room,
    owner,
    stranger,
    app: createRoomsApp(store, runtime, "https://rooms.example"),
  };
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));
describe("room HTTP authorization", () => {
  it("rejects anonymous reads and cross-room sessions", async () => {
    const { app, store, room, stranger } = setup();
    expect((await app.request("/api/rooms/" + room.id)).status).toBe(401);
    expect(
      (
        await app.request("/api/rooms/" + room.id, {
          headers: { cookie: "rooms_session=" + store.session(stranger.id) },
        })
      ).status,
    ).toBe(403);
  });
  it("rejects CSRF and client-forged authors", async () => {
    const { app, store, room, owner } = setup();
    const cookie = "rooms_session=" + store.session(owner.id);
    const body = JSON.stringify({
      text: "hello",
      requestId: crypto.randomUUID(),
      recipients: [],
    });
    expect(
      (
        await app.request("/api/rooms/" + room.id + "/messages", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/rooms/" + room.id + "/messages", {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            "x-rooms-request": "1",
            origin: "https://evil.example",
          },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/rooms/" + room.id + "/messages", {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            "x-rooms-request": "1",
          },
          body: JSON.stringify({ ...JSON.parse(body), authorId: "forged" }),
        })
      ).status,
    ).toBe(400);
  });
  it("attributes a valid send from the authenticated session", async () => {
    const { app, store, room, owner } = setup();
    const result = await app.request("/api/rooms/" + room.id + "/messages", {
      method: "POST",
      headers: {
        cookie: "rooms_session=" + store.session(owner.id),
        "content-type": "application/json",
        "x-rooms-request": "1",
      },
      body: JSON.stringify({
        text: "hello",
        requestId: crypto.randomUUID(),
        recipients: [],
      }),
    });
    expect(result.status).toBe(200);
    expect((await result.json()).message.authorId).toBe(owner.id);
  });
});
