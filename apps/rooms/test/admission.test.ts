import { describe, expect, it } from "vitest";
import { parseThreadEventRow, type ThreadEventRow } from "@bb/domain";
import { inspectAdmission } from "../src/admission.js";

const activation = "7f961440-dc7c-473d-a96b-4d74e44e5c99";
const marker = `\nActivation: ${activation}\n`;
const requestId = "creq_23456789ab";
function event(
  type: string,
  seq: number,
  data: object,
  turnId?: string,
  threadId = "thread-alpha",
) {
  return parseThreadEventRow({
    id: `event-${threadId}-${seq}`,
    threadId,
    seq,
    createdAt: seq,
    type,
    scope: turnId ? { kind: "turn", turnId } : { kind: "thread" },
    data,
  });
}
function requested(seq = 1, id = requestId, text = marker) {
  return event("client/turn/requested", seq, {
    direction: "outbound",
    requestId: id,
    source: "tell",
    initiator: "user",
    senderThreadId: null,
    input: [{ type: "text", text, mentions: [] }],
    target: { kind: "new-turn" },
    request: { method: "turn/start", params: {} },
    execution: {
      model: "local/model",
      serviceTier: "default",
      reasoningLevel: "medium",
      permissionMode: "full",
      source: "client/turn/requested",
    },
  });
}
function accepted(
  seq = 2,
  id = requestId,
  turnId = "turn-alpha",
  threadId = "thread-alpha",
) {
  return event(
    "turn/input/accepted",
    seq,
    { providerThreadId: "provider", clientRequestId: id },
    turnId,
    threadId,
  );
}
function completed(seq = 3, turnId = "turn-alpha", threadId = "thread-alpha") {
  return event(
    "turn/completed",
    seq,
    { providerThreadId: "provider", status: "completed" },
    turnId,
    threadId,
  );
}

describe("durable provider admission proof", () => {
  it("requires matching request, acceptance and terminal turn even with no assistant output", () => {
    expect(inspectAdmission([requested()], activation).state).toBe("pending");
    expect(inspectAdmission([requested(), accepted()], activation).state).toBe(
      "pending",
    );
    expect(
      inspectAdmission([completed(), requested(), accepted()], activation),
    ).toEqual({
      state: "settled",
      requestIds: [requestId],
      turnIds: ["turn-alpha"],
      terminalOutcome: "completed",
      error: null,
    });
    const failed = event(
      "turn/completed",
      3,
      {
        providerThreadId: "provider",
        status: "failed",
        error: { message: "Provider failed" },
      },
      "turn-alpha",
    );
    expect(
      inspectAdmission([requested(), accepted(), failed], activation),
    ).toMatchObject({
      state: "settled",
      terminalOutcome: "failed",
      error: "Provider failed",
    });
  });
  it("does not treat private output, another request, another thread or an earlier turn as acceptance", () => {
    const privateOutput = event(
      "item/agentMessage/delta",
      1,
      { providerThreadId: "provider", itemId: "item", delta: marker },
      "turn-alpha",
    );
    expect(
      inspectAdmission([privateOutput, completed()], activation).state,
    ).toBe("missing");
    expect(
      inspectAdmission(
        [requested(1, requestId, marker.trim()), accepted(), completed()],
        activation,
      ).state,
    ).toBe("missing");
    const invalidProofs: ThreadEventRow[][] = [
      [accepted(2, "creq_23456789ac"), completed()],
      [accepted(), completed(3, "turn-other")],
      [
        accepted(2, requestId, "turn-alpha", "thread-other"),
        completed(3, "turn-alpha", "thread-other"),
      ],
      [accepted(), completed(1)],
    ];
    for (const proof of invalidProofs)
      expect(inspectAdmission([requested(), ...proof], activation).state).toBe(
        "pending",
      );
  });
  it("requires every observed submission to settle and accepts explicit admission rejection", () => {
    const secondId = "creq_23456789ac";
    const first = [requested(), accepted(), completed()];
    const second = requested(4, secondId);
    expect(inspectAdmission([...first, second], activation).state).toBe(
      "pending",
    );
    const rejection = event("client/turn/rejected", 5, {
      requestId: secondId,
      reason: "stopped",
      message: "Admission cancelled",
    });
    expect(
      inspectAdmission([...first, second, rejection], activation),
    ).toMatchObject({
      state: "settled",
      terminalOutcome: "interrupted",
      error: "Admission cancelled",
    });
    expect(
      inspectAdmission(
        [...first, second, rejection, accepted(6, secondId, "turn-next")],
        activation,
      ).state,
    ).toBe("pending");
  });
});
