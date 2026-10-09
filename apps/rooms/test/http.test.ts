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
  it("terminates a stream when its bearer session expires even if a valid cookie is also present", async () => {
    const { app, store, room, owner } = setup();
    const token = store.session(owner.id);
    const response = await app.request(`/api/rooms/${room.id}/events`, {
      headers: {
        authorization: "Bearer " + token,
        cookie: "rooms_session=" + store.session(owner.id),
      },
    });
    const reader = response.body!.getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        "event: snapshot",
      );
      store.logout(token);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        "event: access-error",
      );
    } finally {
      await reader.cancel();
    }
  });
  it("does not publish a human message when live steering is rejected", async () => {
    const { app, store, room, owner } = setup();
    const agent = store.addAgent(room.id, {
      handle: "atlas",
      name: "Atlas",
      provider: "pi",
      model: "local/model",
      instructions: "",
    });
    const response = await app.request(
      `/api/rooms/${room.id}/agents/${agent.id}/steer`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + store.session(owner.id),
          "content-type": "application/json",
          "x-rooms-request": "1",
        },
        body: JSON.stringify({ text: "Change direction" }),
      },
    );
    expect(response.status).toBe(409);
    expect(store.messages(room.id)).toHaveLength(0);
  });
  it("keeps human sessions and agent capabilities in separate authority domains", async () => {
    const { app, store, room, owner } = setup();
    const agent = store.addAgent(room.id, {
      handle: "atlas",
      name: "Atlas",
      provider: "pi",
      model: "local/model",
      instructions: "",
    });
    store.sendHuman(
      owner,
      room.id,
      {
        text: "Respond",
        intent: "request",
        recipients: [agent.id],
        replyTo: null,
      },
      crypto.randomUUID(),
    );
    const activation = store.beginActivation(store.work()[0].id)!;
    const response = await app.request("/api/agent/commands", {
      method: "POST",
      headers: {
        authorization: "Bearer " + store.session(owner.id),
        "content-type": "application/json",
        "x-rooms-request": "1",
      },
      body: JSON.stringify({
        operation: "post",
        requestId: crypto.randomUUID(),
        args: { text: "Forged agent speech" },
      }),
    });
    expect(response.status).toBe(401);
    expect(
      (
        await app.request("/api/me", {
          headers: { authorization: "Bearer " + activation.token },
        })
      ).status,
    ).toBe(401);
    const member = store.register(
      store.invite(room.id),
      "member",
      "Member",
      "correct horse battery",
    );
    for (const operation of ["activity", "recover"]) {
      const result = await app.request(
        `/api/rooms/${room.id}/agents/${agent.id}/${operation}`,
        {
          method: operation === "activity" ? "GET" : "POST",
          headers: {
            authorization: "Bearer " + store.session(member.id),
            "x-rooms-request": "1",
          },
        },
      );
      expect(result.status).toBe(403);
    }
    expect(store.messages(room.id)).toHaveLength(1);
  });
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
