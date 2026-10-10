import { afterEach, expect, it, vi } from "vitest";
import { RoomsStore } from "../src/store.js";
import { RoomRuntime } from "../src/runtime.js";

const stores: RoomsStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  stores.splice(0).forEach((store) => store.close());
});
function fixture() {
  const store = new RoomsStore(":memory:");
  stores.push(store);
  const room = store.createRoom("Workshop", "");
  const owner = store.register(
    store.invite(room.id, "owner"),
    "owner",
    "Owner",
    "correct horse battery",
  );
  const agent = store.addAgent(
    room.id,
    {
      handle: "nova",
      name: "Nova",
      provider: "claude-code",
      model: "existing-model",
      instructions: "",
    },
    {
      projectId: "existing-project",
      environmentId: "existing-environment",
      threadId: "existing-thread",
    },
  );
  return {
    store,
    room,
    owner,
    agent,
    runtime: new RoomRuntime(store, "http://127.0.0.1:1", "/tmp"),
  };
}
it("associates an existing room without moving its agent or replaying history and receipts", () => {
  const { store, room, owner, agent } = fixture();
  const publication = {
    text: "The earlier discussion",
    intent: "post" as const,
    recipients: [],
    replyTo: null,
  };
  const message = store.sendHuman(
    owner,
    room.id,
    publication,
    "same-human-publication",
  ).message;
  const delivery = store.work()[0];
  const activation = store.beginActivation(delivery.id)!;
  store.bindActivation(activation.activation.id, agent.threadId!);
  store.finishActivation(activation.activation.id, "no_reply");
  const before = store.deliveries(room.id);
  store.setRoomContext(room.id, {
    projectId: "new-project",
    defaultEnvironmentId: "new-environment",
    sectionId: "native-section",
  });
  expect(store.agent(agent.id)).toEqual(agent);
  expect(store.messages(room.id)).toEqual([message]);
  expect(store.deliveries(room.id)).toEqual(before);
  expect(
    store.sendHuman(owner, room.id, publication, "same-human-publication")
      .duplicate,
  ).toBe(true);
  expect(store.work()).toEqual([]);
  expect(store.members(room.id)).toEqual([{ ...owner, role: "owner" }]);
});
it("rejects a native thread bound to another participant even across rooms", () => {
  const { store, agent } = fixture();
  const other = store.createRoom("Another room", "");
  expect(() =>
    store.addAgent(
      other.id,
      {
        handle: "atlas",
        name: "Atlas",
        provider: "codex",
        model: "",
        instructions: "",
      },
      {
        projectId: agent.projectId,
        environmentId: agent.environmentId,
        threadId: agent.threadId,
      },
    ),
  ).toThrow("already belongs");
  expect(store.agents(other.id)).toEqual([]);
  const unbound = store.addAgent(other.id, {
    handle: "atlas",
    name: "Atlas",
    provider: "codex",
    model: "",
    instructions: "",
  });
  expect(() =>
    store.saveAgent({ ...unbound, threadId: agent.threadId }),
  ).toThrow("already belongs");
  expect(store.agent(unbound.id).threadId).toBeNull();
});
it("does not stop unrelated native work when only a room message is queued", async () => {
  const { store, room, owner, agent, runtime } = fixture();
  store.sendHuman(
    owner,
    room.id,
    {
      text: "Queued while the owner works privately",
      intent: "post",
      recipients: [],
      replyTo: null,
    },
    "queued",
  );
  const nativeStop = vi
    .spyOn(runtime.sdk.threads, "stop")
    .mockRejectedValue(new Error("Unrelated native work would be interrupted"));
  await runtime.stop(agent.id);
  expect(nativeStop).not.toHaveBeenCalled();
  expect(store.deliveries(room.id)[0].state).toBe("stopped");
  expect(store.work()).toEqual([]);
});
it("requires project context before creating execution instead of inventing another project", async () => {
  const { store, room, runtime } = fixture();
  const create = vi.spyOn(runtime.sdk.projects, "create");
  await expect(
    runtime.addAgent(room.id, {
      handle: "atlas",
      name: "Atlas",
      provider: "codex",
      model: "",
      instructions: "",
    }),
  ).rejects.toThrow("Choose a BB project");
  expect(create).not.toHaveBeenCalled();
  expect(store.agents(room.id)).toHaveLength(1);
});
