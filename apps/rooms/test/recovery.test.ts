import { it, expect, afterEach } from "vitest";
import { RoomsStore } from "../src/store.js";
import { RoomRuntime } from "../src/runtime.js";
const stores: RoomsStore[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function setup() {
  const store = new RoomsStore(":memory:");
  stores.push(store);
  const room = store.createRoom("Recovery", "");
  const owner = store.register(
    store.invite(room.id, "owner"),
    "owner",
    "Owner",
    "correct horse battery",
  );
  const agent = store.addAgent(room.id, {
    handle: "builder",
    name: "Builder",
    provider: "pi",
    model: "local/model",
    instructions: "",
  });
  const message = store.requestMessage(
    owner,
    room.id,
    "work",
    crypto.randomUUID(),
  ).message;
  store.enqueue(agent.id, message);
  const runtime = new RoomRuntime(store, "http://127.0.0.1:1", "/tmp");
  return { store, room, agent, runtime };
}
it("surfaces an ambiguous dispatch after restart without duplicating it", () => {
  const { store, room, agent, runtime } = setup();
  const delivery = store.work()[0];
  store.beginActivation(delivery.id);
  runtime.start();
  runtime.close();
  expect(store.work()).toEqual([]);
  expect(store.deliveries(room.id)[0].state).toBe("uncertain");
  expect(store.agent(agent.id).status).toBe("uncertain");
  expect(store.deliveries(room.id)[0].error).toContain("may have accepted");
  expect(store.messages(room.id)).toHaveLength(1);
});
it("cancels queued deliveries and ignores a late execution failure after stop", async () => {
  const { store, room, agent, runtime } = setup();
  const stale = store.work()[0];
  await runtime.stop(agent.id);
  runtime.fail(stale, new Error("Late network failure"));
  expect(store.work()).toEqual([]);
  expect(store.deliveries(room.id)[0].state).toBe("stopped");
  expect(store.agent(agent.id).status).toBe("idle");
  expect(store.messages(room.id)).toHaveLength(1);
});
it("rejects a human join that would collide with an existing agent handle", () => {
  const { store, room } = setup();
  const invite = store.invite(room.id);
  expect(() =>
    store.register(invite, "builder", "Human Builder", "correct horse battery"),
  ).toThrow("belongs to an agent");
  expect(
    store.register(
      invite,
      "builder_human",
      "Human Builder",
      "correct horse battery",
    ).handle,
  ).toBe("builder_human");
});
