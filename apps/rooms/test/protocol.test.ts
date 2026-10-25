import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Publication } from "../src/contracts.js";
import { RoomsStore } from "../src/store.js";
import { executeAgentCommand } from "../src/protocol.js";
const stores: RoomsStore[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of directories.splice(0))
    rmSync(d, { recursive: true, force: true });
});
function setup(path = ":memory:") {
  const store = new RoomsStore(path);
  stores.push(store);
  const room = store.createRoom("Room", "");
  const human = store.register(
    store.invite(room.id, "owner"),
    "owner",
    "Owner",
    "correct horse battery",
  );
  const second = store.register(
    store.invite(room.id),
    "second",
    "Second",
    "correct horse battery",
  );
  const a = store.addAgent(room.id, {
    handle: "alpha",
    name: "Alpha",
    provider: "pi",
    model: "test",
    instructions: "",
  });
  const b = store.addAgent(room.id, {
    handle: "bravo",
    name: "Bravo",
    provider: "pi",
    model: "test",
    instructions: "",
  });
  const trigger = store.sendHuman(
    human,
    room.id,
    {
      text: "Discuss",
      intent: "request",
      recipients: [a.id, b.id],
      replyTo: null,
    },
    "trigger",
  ).message;
  const da = store.work().find((d) => d.agentId === a.id)!;
  const db = store.work().find((d) => d.agentId === b.id)!;
  const ca = store.beginActivation(da.id)!;
  const cb = store.beginActivation(db.id)!;
  store.bindActivation(ca.activation.id, "thread-alpha");
  store.bindActivation(cb.activation.id, "thread-bravo");
  function command(
    capability: string,
    operation: string,
    args: object = {},
    requestId: string = crypto.randomUUID(),
  ) {
    return executeAgentCommand(store, capability, {
      operation,
      requestId,
      args,
    });
  }
  return { store, room, human, second, a, b, trigger, da, db, ca, cb, command };
}
const publication: Publication = {
  text: "A public contribution",
  intent: "post",
  recipients: [],
  replyTo: null,
};
describe("explicit authenticated participation", () => {
  it("binds a steering publication to its durable target and human text without replaying cancelled input", () => {
    const { store, room, human, second, a, b, ca } = setup();
    const text = "Use the revised plan";
    store.recordSteering(
      ca.activation.id,
      "thread-alpha",
      "steer-publication",
      `Steering from human ${human.name} (@${human.handle}): ${text}`,
    );
    for (const [actor, target, content] of [
      [second, a.id, text],
      [human, b.id, text],
      [human, a.id, "Changed input"],
    ] as const) {
      expect(() =>
        store.publishAcknowledgedSteering(
          actor,
          room.id,
          target,
          content,
          "steer-publication",
        ),
      ).toThrow();
    }
    expect(store.messages(room.id)).toHaveLength(1);
    store.fenceAgent(a.id, "Stopped after acknowledgement");
    const receipt = store.publishAcknowledgedSteering(
      human,
      room.id,
      a.id,
      text,
      "steer-publication",
    );
    expect(
      store.publishAcknowledgedSteering(
        human,
        room.id,
        a.id,
        text,
        "steer-publication",
      ),
    ).toMatchObject({
      message: { id: receipt.message.id },
      duplicate: true,
    });
    expect(
      store
        .deliveries(room.id)
        .filter((d) => d.messageId === receipt.message.id),
    ).toEqual([expect.objectContaining({ agentId: b.id, intent: "notice" })]);
    expect(store.pendingSteerings(ca.activation.id)).toHaveLength(1);
    const next = setup();
    next.store.recordSteering(
      next.ca.activation.id,
      "thread-alpha",
      "cancelled-steer",
      `Steering from human ${next.human.name} (@${next.human.handle}): ${text}`,
    );
    next.store.fenceAgent(
      next.a.id,
      "Cancelled before acknowledgement returned",
    );
    next.store.settleSteering(
      next.ca.activation.id,
      "thread-alpha",
      "cancelled-steer",
      "cancelled",
    );
    expect(() =>
      next.store.publishAcknowledgedSteering(
        next.human,
        next.room.id,
        next.a.id,
        text,
        "cancelled-steer",
      ),
    ).toThrow("cancelled");
    expect(next.store.messages(next.room.id)).toHaveLength(1);
    expect(
      next.store
        .work()
        .filter((d) => d.agentId === next.a.id && d.state === "queued"),
    ).toEqual([]);
  });
  it("delivers completed public messages once to every peer with addressed request precedence", () => {
    const { store, room, human, second, a, b, ca, command } = setup();
    const c = store.addAgent(room.id, {
      handle: "charlie",
      name: "Charlie",
      provider: "pi",
      model: "test",
      instructions: "",
    });
    const otherRoom = store.createRoom("Other", human.id);
    store.addAgent(otherRoom.id, {
      handle: "elsewhere",
      name: "Elsewhere",
      provider: "pi",
      model: "test",
      instructions: "",
    });
    for (const author of [human, second]) {
      for (const intent of ["post", "notice", "request"] as const) {
        const input = { ...publication, intent, recipients: [a.id] };
        const requestId = `${author.id}-${intent}`;
        const receipt = store.sendHuman(author, room.id, input, requestId);
        expect(
          store.sendHuman(author, room.id, input, requestId),
        ).toMatchObject({
          message: { id: receipt.message.id },
          duplicate: true,
        });
        const deliveries = store
          .deliveries(room.id)
          .filter((d) => d.messageId === receipt.message.id);
        expect(deliveries).toHaveLength(3);
        expect(deliveries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              agentId: a.id,
              intent: intent === "request" ? "request" : "notice",
            }),
            expect.objectContaining({ agentId: b.id, intent: "notice" }),
            expect.objectContaining({ agentId: c.id, intent: "notice" }),
          ]),
        );
      }
    }
    const receipt = z
      .object({ message: z.object({ id: z.string() }) })
      .parse(command(ca.token, "post", publication, "room-question"));
    command(ca.token, "post", publication, "room-question");
    const deliveries = store
      .deliveries(room.id)
      .filter((d) => d.messageId === receipt.message.id);
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: b.id, intent: "notice" }),
        expect.objectContaining({ agentId: c.id, intent: "notice" }),
      ]),
    );
    expect(store.deliveries(otherRoom.id)).toEqual([]);
  });
  it("retains the execution lease across restart and Stop until every steering submission settles", () => {
    const directory = mkdtempSync(join(tmpdir(), "rooms-steering-"));
    directories.push(directory);
    const path = join(directory, "rooms.db");
    const { store, ca, cb, a, b, human, room } = setup(path);
    const activationId = ca.activation.id;
    store.recordSteering(
      activationId,
      "thread-alpha",
      "steer-first",
      "Use the corrected approach",
    );
    store.recordSteering(
      activationId,
      "thread-alpha",
      "steer-second",
      "Include the new constraint",
    );
    expect(() => store.finishActivation(activationId, "no_reply")).toThrow(
      "Steering admission is unresolved",
    );
    expect(() =>
      store.recordSteering(
        activationId,
        "thread-alpha",
        "steer-first",
        "Changed input",
      ),
    ).toThrow("another execution");
    expect(() =>
      store.settleSteering(
        activationId,
        "thread-alpha",
        "steer-first",
        "cancelled",
      ),
    ).toThrow("Fence the activation");
    expect(() =>
      store.recordSteering(
        cb.activation.id,
        "thread-bravo",
        "steer-first",
        "Use the corrected approach",
      ),
    ).toThrow("another execution");
    expect(() =>
      store.settleSteering(
        activationId,
        "thread-bravo",
        "steer-first",
        "settled",
      ),
    ).toThrow("another execution thread");
    expect(() =>
      store.settleSteering(
        cb.activation.id,
        "thread-bravo",
        "steer-first",
        "settled",
      ),
    ).toThrow("does not belong");
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const restarted = new RoomsStore(path);
    stores.push(restarted);
    restarted.recoverActivations();
    expect(
      restarted.pendingSteerings(activationId).map((steering) => steering.id),
    ).toEqual(["steer-first", "steer-second"]);
    expect(restarted.pendingSteerings(activationId)[0].text).toBe(
      "Use the corrected approach",
    );
    restarted.fenceAgent(a.id, "Stopped during a lost steering acknowledgment");
    expect(() =>
      restarted.recordSteering(
        activationId,
        "thread-alpha",
        "too-late",
        "Stopped input",
      ),
    ).toThrow("requires the active execution");
    restarted.sendHuman(
      human,
      room.id,
      {
        ...publication,
        intent: "request",
        recipients: [a.id],
      },
      "after-stop",
    );
    const waiting = restarted
      .work()
      .find(
        (delivery) => delivery.agentId === a.id && delivery.state === "queued",
      )!;
    expect(restarted.beginActivation(waiting.id)).toBeNull();
    expect(() => restarted.finishActivation(activationId, "no_reply")).toThrow(
      "Steering admission is unresolved",
    );
    restarted.markActivationUncertain(
      activationId,
      "Lost steering acknowledgment",
    );
    expect(() => restarted.resolveUncertain(a.id)).toThrow(
      "Steering admission is unresolved",
    );
    restarted.settleSteering(
      activationId,
      "thread-alpha",
      "steer-first",
      "settled",
    );
    restarted.settleSteering(
      activationId,
      "thread-alpha",
      "steer-first",
      "settled",
    );
    expect(() => restarted.resolveUncertain(a.id)).toThrow(
      "Steering admission is unresolved",
    );
    expect(() =>
      restarted.recordQueueCancellation(
        activationId,
        "thread-alpha",
        "queued-steer",
        ["steer-second", "unknown-steer"],
      ),
    ).toThrow("does not belong");
    expect(restarted.hasQueueCancellation(activationId, "thread-alpha")).toBe(
      false,
    );
    expect(
      restarted.pendingSteerings(activationId).map((steering) => steering.id),
    ).toEqual(["steer-second"]);
    restarted.recordQueueCancellation(
      activationId,
      "thread-alpha",
      "queued-steer",
      ["steer-second"],
    );
    expect(() =>
      restarted.settleSteering(
        activationId,
        "thread-alpha",
        "steer-second",
        "settled",
      ),
    ).toThrow("another terminal outcome");
    restarted.resolveUncertain(a.id);
    restarted.markActivationUncertain(activationId, "Late transport failure");
    expect(restarted.activation(activationId).state).toBe("stopped");
    expect(restarted.beginActivation(waiting.id)).not.toBeNull();
    expect(restarted.agent(b.id).status).toBe("working");
  });
  it("publishes only under the capability identity and atomically validates recipients and reply scope", () => {
    const { store, room, second, a, b, ca, command } = setup();
    const otherRoom = store.createRoom("Other", second.id);
    const other = store.sendHuman(
      second,
      otherRoom.id,
      { ...publication, intent: "post" },
      "other",
    ).message;
    for (const args of [
      { ...publication, authorId: b.id },
      { ...publication, roomId: otherRoom.id },
      { ...publication, intent: "request", recipients: ["unknown"] },
      { ...publication, intent: "request", recipients: [a.id] },
      { ...publication, replyTo: other.id },
    ]) {
      expect(() => command(ca.token, "post", args)).toThrow();
    }
    expect(store.messages(room.id)).toHaveLength(1);
    const addressed = { ...publication, recipients: [a.id, b.id] };
    const result = command(ca.token, "post", addressed, "post-once");
    expect(result).toMatchObject({
      message: { authorId: a.id, authorName: "Alpha", text: publication.text },
    });
    expect(command(ca.token, "post", addressed, "post-once")).toEqual(result);
    expect(() =>
      command(
        ca.token,
        "post",
        { ...publication, text: "different" },
        "post-once",
      ),
    ).toThrow("different request");
    expect(store.messages(room.id)).toHaveLength(2);
    expect(store.deliveries(room.id)).toHaveLength(3);
  });
  it("keeps explicit silence successful without releasing an active provider lease", () => {
    const { store, room, second, a, ca, da, command } = setup();
    store.sendHuman(
      second,
      room.id,
      {
        text: "A new human turn",
        intent: "notice",
        recipients: [a.id],
        replyTo: null,
      },
      "followup",
    );
    const queued = store
      .work()
      .find((d) => d.agentId === a.id && d.state === "queued")!;
    const deliveriesBeforeSilence = store.deliveries(room.id);
    expect(
      command(ca.token, "settle", { outcome: "no_reply" }, "silent"),
    ).toEqual({ outcome: "no_reply" });
    expect(store.beginActivation(queued.id)).toBeNull();
    expect(store.delivery(da.id).state).toBe("running");
    expect(() => command(ca.token, "post", publication)).toThrow(
      "no longer active",
    );
    store.finishActivation(ca.activation.id, "no_reply");
    expect(store.delivery(da.id)).toMatchObject({
      state: "complete",
      outcome: "no_reply",
    });
    expect(store.beginActivation(queued.id)).not.toBeNull();
    expect(store.messages(room.id)).toHaveLength(2);
    expect(store.deliveries(room.id).map((d) => d.id)).toEqual(
      deliveriesBeforeSilence.map((d) => d.id),
    );
  });
  it("streams selected public content with ordered retries and one notification at commit", () => {
    const { store, room, b, ca, cb, command } = setup();
    const c = store.addAgent(room.id, {
      handle: "charlie",
      name: "Charlie",
      provider: "pi",
      model: "test",
      instructions: "",
    });
    const aborted = z
      .object({ messageId: z.string() })
      .parse(command(ca.token, "stream.begin", {}, "aborted-begin"));
    command(ca.token, "stream.append", {
      ...aborted,
      sequence: 0,
      text: "Aborted",
    });
    command(ca.token, "stream.abort", aborted);
    expect(
      store
        .deliveries(room.id)
        .filter((d) => d.messageId === aborted.messageId),
    ).toEqual([]);
    const begun = command(ca.token, "stream.begin", {}, "begin");
    expect(begun).toEqual(command(ca.token, "stream.begin", {}, "begin"));
    const { messageId } = z.object({ messageId: z.string() }).parse(begun);
    expect(() =>
      command(cb.token, "stream.append", {
        messageId,
        sequence: 0,
        text: "forged",
      }),
    ).toThrow("another activation");
    expect(() =>
      command(ca.token, "stream.append", {
        messageId,
        sequence: 1,
        text: "gap",
      }),
    ).toThrow("sequence gap");
    command(ca.token, "stream.append", {
      messageId,
      sequence: 0,
      text: "Selected ",
    });
    command(ca.token, "stream.append", {
      messageId,
      sequence: 0,
      text: "Selected ",
    });
    expect(() =>
      command(ca.token, "stream.append", {
        messageId,
        sequence: 0,
        text: "changed",
      }),
    ).toThrow("different content");
    command(ca.token, "stream.append", {
      messageId,
      sequence: 1,
      text: "public text",
    });
    expect(store.message(messageId)).toMatchObject({
      text: "Selected public text",
      status: "streaming",
    });
    expect(store.deliveries(room.id)).toHaveLength(2);
    const commit = {
      messageId,
      intent: "request",
      recipients: [b.id],
      replyTo: null,
    };
    const first = command(ca.token, "stream.commit", commit, "commit");
    expect(command(ca.token, "stream.commit", commit, "commit")).toEqual(first);
    command(ca.token, "stream.commit", commit, "replay-new-key");
    expect(() =>
      command(
        ca.token,
        "stream.commit",
        { ...commit, recipients: [] },
        "changed-targets",
      ),
    ).toThrow("different recipients");
    expect(() =>
      command(ca.token, "stream.append", {
        messageId,
        sequence: 2,
        text: "late",
      }),
    ).toThrow("terminal");
    const deliveries = store
      .deliveries(room.id)
      .filter((d) => d.messageId === messageId);
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: b.id, intent: "request" }),
        expect.objectContaining({ agentId: c.id, intent: "notice" }),
      ]),
    );
    expect(store.message(messageId).status).toBe("complete");
  });
  it("preserves running capabilities across restart while fencing ambiguous dispatch without replay", () => {
    const directory = mkdtempSync(join(tmpdir(), "rooms-protocol-"));
    directories.push(directory);
    const path = join(directory, "state.sqlite");
    const { store, room, human, a, ca, command } = setup(path);
    command(ca.token, "post", publication, "persisted");
    const c = store.addAgent(room.id, {
      handle: "charlie",
      name: "Charlie",
      provider: "pi",
      model: "test",
      instructions: "",
    });
    store.sendHuman(
      human,
      room.id,
      {
        text: "Ambiguous request",
        intent: "request",
        recipients: [c.id],
        replyTo: null,
      },
      "ambiguous",
    );
    const pending = store.work().find((d) => d.agentId === c.id)!;
    const uncertain = store.beginActivation(pending.id)!;
    store.sendHuman(
      human,
      room.id,
      {
        text: "Queued behind ambiguity",
        intent: "notice",
        recipients: [c.id],
        replyTo: null,
      },
      "after",
    );
    const next = store
      .work()
      .find((d) => d.agentId === c.id && d.state === "queued")!;
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new RoomsStore(path);
    stores.push(reopened);
    reopened.recoverActivations();
    expect(reopened.activation(ca.activation.id)).toMatchObject({
      state: "running",
      revoked: false,
      threadId: "thread-alpha",
    });
    expect(
      executeAgentCommand(reopened, ca.token, {
        operation: "post",
        requestId: "persisted",
        args: publication,
      }),
    ).toMatchObject({ message: { authorId: a.id } });
    expect(reopened.delivery(pending.id).state).toBe("uncertain");
    expect(() =>
      executeAgentCommand(reopened, uncertain.token, {
        operation: "post",
        requestId: "stale",
        args: publication,
      }),
    ).toThrow("no longer active");
    expect(reopened.beginActivation(next.id)).toBeNull();
    expect(reopened.messages(room.id)).toHaveLength(4);
    const error = reopened.delivery(pending.id).error;
    reopened.fenceAgent(
      c.id,
      "Recovering uncertain execution",
      "active-execution",
    );
    expect(reopened.delivery(next.id).state).toBe("queued");
    expect(reopened.agent(c.id).status).toBe("uncertain");
    reopened.resolveUncertain(c.id);
    expect(reopened.delivery(pending.id)).toMatchObject({
      state: "stopped",
      error,
    });
    expect(reopened.activation(uncertain.activation.id)).toMatchObject({
      state: "stopped",
      revoked: true,
    });
    expect(reopened.beginActivation(next.id)).not.toBeNull();
    expect(() =>
      executeAgentCommand(reopened, uncertain.token, {
        operation: "post",
        requestId: "late-after-recovery",
        args: publication,
      }),
    ).toThrow("no longer active");
  });
  it("persists successful queue cancellation separately from uncertain or wrong-thread admission", () => {
    const directory = mkdtempSync(join(tmpdir(), "rooms-cancel-"));
    directories.push(directory);
    const path = join(directory, "state.sqlite");
    const { store, a, ca, cb } = setup(path);
    expect(() =>
      store.recordQueueCancellation(
        ca.activation.id,
        "thread-alpha",
        "queued-alpha",
      ),
    ).toThrow("Fence the activation");
    store.fenceAgent(a.id, "Stopped by a human");
    expect(() =>
      store.recordQueueCancellation(
        ca.activation.id,
        "thread-bravo",
        "queued-alpha",
      ),
    ).toThrow("another execution thread");
    store.recordQueueCancellation(
      ca.activation.id,
      "thread-alpha",
      "queued-alpha",
    );
    store.recordQueueCancellation(
      ca.activation.id,
      "thread-alpha",
      "queued-alpha",
    );
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new RoomsStore(path);
    stores.push(reopened);
    expect(
      reopened.hasQueueCancellation(ca.activation.id, "thread-alpha"),
    ).toBe(true);
    expect(
      reopened.hasQueueCancellation(ca.activation.id, "thread-bravo"),
    ).toBe(false);
    expect(
      reopened.hasQueueCancellation(cb.activation.id, "thread-alpha"),
    ).toBe(false);
    expect(reopened.delivery(ca.activation.deliveryId).state).toBe("stopped");
    expect(reopened.activation(ca.activation.id).state).toBe("running");
  });
  it("serializes same-agent claims across database connections while letting independent agents participate", () => {
    const directory = mkdtempSync(join(tmpdir(), "rooms-claims-"));
    directories.push(directory);
    const path = join(directory, "state.sqlite");
    const { store, room, human, a, ca, cb } = setup(path);
    const other = new RoomsStore(path);
    stores.push(other);
    store.sendHuman(
      human,
      room.id,
      { text: "Next", intent: "request", recipients: [a.id], replyTo: null },
      "next",
    );
    const next = store
      .work()
      .find((d) => d.agentId === a.id && d.state === "queued")!;
    expect(other.beginActivation(next.id)).toBeNull();
    expect(store.activation(cb.activation.id).state).toBe("running");
    store.fenceAgent(a.id, "Stopped by a human");
    expect(other.delivery(next.id).state).toBe("stopped");
    expect(other.beginActivation(next.id)).toBeNull();
    store.finishActivation(ca.activation.id, "no_reply");
    expect(other.activation(ca.activation.id).state).toBe("stopped");
    expect(() =>
      executeAgentCommand(other, ca.token, {
        operation: "post",
        requestId: "late",
        args: publication,
      }),
    ).toThrow("no longer active");
  });
  it("keeps a budget pause distinct from a human pause when room controls are saved", () => {
    const { store, room, human, a, ca, cb } = setup();
    store.finishActivation(ca.activation.id, "no_reply");
    store.finishActivation(cb.activation.id, "no_reply");
    store.setPolicy(room.id, { paused: false, maxActivations: 2 });
    store.sendHuman(
      human,
      room.id,
      {
        text: "Continue",
        intent: "request",
        recipients: [a.id],
        replyTo: null,
      },
      "continue",
    );
    const next = store.work().find((d) => d.state === "queued")!;
    expect(store.beginActivation(next.id)).toBeNull();
    const budgetPaused = store.room(room.id);
    expect(budgetPaused).toMatchObject({
      paused: true,
      pauseReason: "Configured activation budget reached",
    });
    store.setPolicy(room.id, {
      paused: budgetPaused.paused,
      maxActivations: 2,
    });
    expect(store.room(room.id)).toMatchObject({
      paused: true,
      pauseReason: "Configured activation budget reached",
    });
    store.setPolicy(room.id, {
      paused: budgetPaused.paused,
      maxActivations: 3,
    });
    expect(store.room(room.id)).toMatchObject({
      paused: false,
      pauseReason: null,
      activationsUsed: 2,
      maxActivations: 3,
    });
    expect(store.beginActivation(next.id)).not.toBeNull();
    store.setPolicy(room.id, { paused: true, maxActivations: 3 });
    store.setPolicy(room.id, { paused: true, maxActivations: null });
    expect(store.room(room.id)).toMatchObject({
      paused: true,
      pauseReason: "Paused by a human",
    });
  });
  it("exposes configurable activation budgets and explicit pause without forbidding conversational depth", () => {
    const { store, room, human, a, b, ca, cb } = setup();
    store.finishActivation(ca.activation.id, "no_reply");
    store.finishActivation(cb.activation.id, "no_reply");
    store.setPolicy(room.id, { paused: false, maxActivations: 2 });
    store.sendHuman(
      human,
      room.id,
      {
        text: "Continue",
        intent: "request",
        recipients: [a.id],
        replyTo: null,
      },
      "continue",
    );
    const next = store.work().find((d) => d.state === "queued")!;
    expect(store.beginActivation(next.id)).toBeNull();
    expect(store.room(room.id)).toMatchObject({
      paused: true,
      pauseReason: "Configured activation budget reached",
    });
    store.setPolicy(room.id, { paused: false, maxActivations: null });
    const active = store.beginActivation(next.id)!;
    store.bindActivation(active.activation.id, "thread-next");
    let current = active,
      recipient = b.id;
    for (let turn = 0; turn < 4; turn++) {
      executeAgentCommand(store, current.token, {
        operation: "request",
        requestId: `ask-${turn}`,
        args: {
          text: `Discussion ${turn}`,
          recipients: [recipient],
          replyTo: null,
        },
      });
      store.finishActivation(current.activation.id, "replied");
      const delivery = store
        .work()
        .find((d) => d.agentId === recipient && d.state === "queued")!;
      current = store.beginActivation(delivery.id)!;
      store.bindActivation(current.activation.id, `thread-${turn}`);
      recipient = recipient === a.id ? b.id : a.id;
    }
    expect(
      store.messages(room.id).filter((m) => m.kind === "agent"),
    ).toHaveLength(4);
    store.setPolicy(room.id, { paused: true, maxActivations: null });
    executeAgentCommand(store, current.token, {
      operation: "post",
      requestId: "after-pause",
      args: publication,
    });
    store.sendHuman(
      human,
      room.id,
      { ...publication, intent: "request", recipients: [recipient] },
      "queued-while-paused",
    );
    const waiting = store
      .work()
      .find((d) => d.agentId === recipient && d.state === "queued")!;
    expect(store.beginActivation(waiting.id)).toBeNull();
    expect(store.delivery(waiting.id).state).toBe("queued");
    store.finishActivation(current.activation.id, "replied");
    store.setPolicy(room.id, { paused: false, maxActivations: null });
    expect(store.beginActivation(waiting.id)).not.toBeNull();
  });
});
