import { it, expect } from "vitest";
import { createExperimentalRoomsClient } from "@bb/sdk";
import { RoomsStore } from "../src/store.js";
import { RoomRuntime } from "../src/runtime.js";
import { createRoomsApp } from "../src/app.js";
it("shares authenticated, idempotent messaging and logout between SDK and gateway", async () => {
  const store = new RoomsStore(":memory:");
  try {
    const room = store.createRoom("SDK", "");
    const user = store.register(
      store.invite(room.id, "owner"),
      "sdk_user",
      "SDK Human",
      "correct horse battery",
    );
    const token = store.session(user.id);
    const app = createRoomsApp(
      store,
      new RoomRuntime(store, "http://127.0.0.1:1", "/tmp"),
      "https://rooms.test",
    );
    const client = createExperimentalRoomsClient({
      baseUrl: "https://rooms.test",
      token,
      fetch: async (input, init) => app.request(new Request(input, init)),
    });
    expect((await client.me()).user.id).toBe(user.id);
    const prompt = {
      text: "hello",
      requestId: crypto.randomUUID(),
      recipients: [],
    };
    await client.send(room.id, prompt);
    await client.send(room.id, prompt);
    expect((await client.room(room.id)).messages).toHaveLength(1);
    await client.request("POST", "/logout", {});
    await expect(client.me()).rejects.toThrow("Sign in");
  } finally {
    store.close();
  }
});
