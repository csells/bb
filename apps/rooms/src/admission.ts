import type { ThreadEventRow } from "@bb/domain";

export function inspectAdmission(
  events: readonly ThreadEventRow[],
  activationId: string,
) {
  return inspectMarkedAdmission(events, [`\nActivation: ${activationId}\n`]);
}

export function inspectSteeringAdmission(
  events: readonly ThreadEventRow[],
  activationId: string,
  steeringId: string,
  expectedText: string,
) {
  return inspectMarkedAdmission(
    events,
    [],
    `\nActivation: ${activationId}\nSteering: ${steeringId}\n${expectedText}`,
  );
}

function inspectMarkedAdmission(
  events: readonly ThreadEventRow[],
  markers: readonly string[],
  exactText?: string,
) {
  const requests = events.filter(
    (event) =>
      event.type === "client/turn/requested" &&
      event.data.input.some(
        (input) =>
          input.type === "text" &&
          (exactText === undefined
            ? markers.every((marker) => input.text.includes(marker))
            : input.text === exactText),
      ),
  );
  const requestIds: string[] = [];
  const turnIds = new Set<string>();
  let pending = false;
  let terminalOutcome: "completed" | "failed" | "interrupted" | null = null;
  let error: string | null = null;
  for (const request of requests) {
    if (request.type !== "client/turn/requested") continue;
    requestIds.push(request.data.requestId);
    const related = events.filter(
      (event) => event.threadId === request.threadId && event.seq > request.seq,
    );
    const rejected = related.find(
      (event) =>
        event.type === "client/turn/rejected" &&
        event.data.requestId === request.data.requestId,
    );
    const accepted = related.filter(
      (event) =>
        event.type === "turn/input/accepted" &&
        event.data.clientRequestId === request.data.requestId,
    );
    if (rejected?.type === "client/turn/rejected" && accepted.length === 0) {
      terminalOutcome = terminalOutcome === "failed" ? "failed" : "interrupted";
      error ??= rejected.data.message;
      continue;
    }
    if (accepted.length === 0) pending = true;
    for (const acceptance of accepted) {
      if (acceptance.scope.kind !== "turn") {
        pending = true;
        continue;
      }
      const turnId = acceptance.scope.turnId;
      turnIds.add(turnId);
      const completion = related.find(
        (event) =>
          event.type === "turn/completed" &&
          event.seq > acceptance.seq &&
          event.scope.kind === "turn" &&
          event.scope.turnId === turnId,
      );
      if (completion?.type !== "turn/completed") {
        pending = true;
        continue;
      }
      const status = completion.data.status;
      if (
        terminalOutcome === null ||
        status === "failed" ||
        (status === "interrupted" && terminalOutcome !== "failed")
      )
        terminalOutcome = status;
      error ??= completion.data.error?.message ?? null;
    }
  }
  const state =
    requests.length === 0 ? "missing" : pending ? "pending" : "settled";
  return {
    state,
    requestIds,
    turnIds: [...turnIds],
    terminalOutcome: state === "settled" ? terminalOutcome : null,
    error,
  };
}
