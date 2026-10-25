import { afterEach, expect, it, vi } from "vitest";
import { parseThreadEventRow } from "@bb/domain";
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
  const added = store.addAgent(room.id, {
    handle: "nova",
    name: "Nova",
    provider: "claude-code",
    model: "existing-model",
    instructions: "",
  });
  store.saveAgent({
    ...added,
    projectId: "room-project",
    threadId: "agent-thread",
  });
  const runtime = new RoomRuntime(store, "http://127.0.0.1:1", "/tmp");
  const send = (text: string) =>
    store.sendHuman(
      owner,
      room.id,
      { text, intent: "post", recipients: [], replyTo: null },
      crypto.randomUUID(),
    );
  return { store, room, agent: store.agent(added.id), runtime, send };
}
function event(type: string, seq: number, data: object, turnId?: string) {
  return parseThreadEventRow({
    id: `event-${seq}`,
    threadId: "agent-thread",
    seq,
    createdAt: seq,
    type,
    scope: turnId ? { kind: "turn", turnId } : { kind: "thread" },
    data,
  });
}
function admittedTurn(
  activationId: string,
  turnId: string,
  seq: number,
  requestId: string,
) {
  return [
    event("client/turn/requested", seq, {
      direction: "outbound",
      requestId,
      source: "tell",
      initiator: "user",
      senderThreadId: null,
      input: [
        { type: "text", text: `\nActivation: ${activationId}\n`, mentions: [] },
      ],
      target: { kind: "new-turn" },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "existing-model",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "accept-edits",
        source: "client/turn/requested",
      },
    }),
    event(
      "turn/input/accepted",
      seq + 1,
      { providerThreadId: "provider", clientRequestId: requestId },
      turnId,
    ),
  ];
}
function completed(turnId: string, seq: number) {
  return event(
    "turn/completed",
    seq,
    { providerThreadId: "provider", status: "completed" },
    turnId,
  );
}
function startActivation(store: RoomsStore) {
  const delivery = store.work()[0];
  const started = store.beginActivation(delivery.id)!;
  store.bindActivation(started.activation.id, "agent-thread");
  return started.activation.id;
}
function stubThread(runtime: RoomRuntime, events: unknown[]) {
  vi.spyOn(runtime.sdk.threads.events, "list").mockResolvedValue(
    events as never,
  );
  vi.spyOn(runtime.sdk.threads.queuedMessages, "list").mockResolvedValue(
    [] as never,
  );
  vi.spyOn(runtime.sdk.threads, "get").mockResolvedValue({
    status: "idle",
  } as never);
  return vi.spyOn(runtime.sdk.threads, "stop").mockResolvedValue({ ok: true });
}
it("does not stop the agent's BB thread when only a room message is queued", async () => {
  const { store, room, agent, runtime, send } = fixture();
  send("Queued while the owner works privately");
  const nativeStop = vi
    .spyOn(runtime.sdk.threads, "stop")
    .mockRejectedValue(new Error("Unrelated work would be interrupted"));
  await runtime.stop(agent.id);
  expect(nativeStop).not.toHaveBeenCalled();
  expect(store.deliveries(room.id)[0].state).toBe("stopped");
  expect(store.work()).toEqual([]);
});
it("stops only the turn its own activation started", async () => {
  const { store, agent, runtime, send } = fixture();
  send("Work on this");
  const activationId = startActivation(store);
  const stop = stubThread(runtime, [
    ...admittedTurn(
      "an-earlier-activation",
      "turn-earlier",
      1,
      "creq_23456789ab",
    ),
    completed("turn-earlier", 3),
    ...admittedTurn(activationId, "turn-room", 4, "creq_3456789abc"),
  ]);
  await runtime.stop(agent.id);
  expect(stop.mock.calls).toEqual([
    [{ threadId: "agent-thread", expectedTurnId: "turn-room" }],
  ]);
});
it("leaves a later private turn running after its own room turn finished", async () => {
  const { store, agent, runtime, send } = fixture();
  send("Work on this");
  const activationId = startActivation(store);
  const stop = stubThread(runtime, [
    ...admittedTurn(activationId, "turn-room", 1, "creq_23456789ab"),
    completed("turn-room", 3),
    event(
      "turn/input/accepted",
      5,
      { providerThreadId: "provider", clientRequestId: "creq_456789abcd" },
      "turn-private",
    ),
  ]);
  await runtime.stop(agent.id);
  expect(stop).not.toHaveBeenCalled();
});
