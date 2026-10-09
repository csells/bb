import { it, expect, afterEach, vi } from "vitest";
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
  store.saveDelivery({ ...delivery, state: "dispatching" });
  store.saveAgent({ ...agent, status: "starting" });
  const spawn = vi.spyOn(runtime.sdk.threads, "spawn");
  runtime.start();
  runtime.close();
  expect(spawn).not.toHaveBeenCalled();
  expect(store.work()).toEqual([]);
  expect(store.deliveries(room.id)[0].state).toBe("error");
  expect(store.agent(agent.id).status).toBe("error");
  expect(store.messages(room.id).at(-1)?.text).toContain(
    "may have been accepted",
  );
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
