import type { ProviderErrorCategory, ThreadEventRow } from "@bb/domain";

function providerFailure(
  diagnostic: string,
  category: ProviderErrorCategory | undefined,
) {
  if (
    category === "unauthorized" ||
    /failed to authenticate|oauth session expired/iu.test(diagnostic)
  )
    return "The provider login expired or was rejected. The room owner needs to reconnect this provider before trying again.";
  if (category === "rate-limit")
    return "The provider's usage limit was reached. Wait for it to reset before trying again.";
  if (category === "billing" || category === "budget-exceeded")
    return "The provider could not continue because of an account or spending limit. The room owner needs to check the provider account.";
  if (
    category === "overloaded" ||
    category === "connection-failed" ||
    category === "stream-disconnected" ||
    category === "internal"
  )
    return "The provider connection failed or the service is temporarily unavailable. Try again when the service recovers.";
  return null;
}

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
      if (status === "failed" && error === null) {
        const diagnostics = related.filter(
          (event) =>
            event.type === "provider/error" &&
            event.seq > acceptance.seq &&
            event.seq < completion.seq &&
            event.scope.kind === "turn" &&
            event.scope.turnId === turnId &&
            event.data.willRetry !== true,
        );
        for (const diagnostic of diagnostics.toReversed()) {
          if (diagnostic.type !== "provider/error") continue;
          error = providerFailure(
            `${diagnostic.data.message}\n${diagnostic.data.detail ?? ""}`,
            diagnostic.data.errorInfo?.category,
          );
          if (error !== null) break;
        }
        if (error === null && completion.data.error)
          error =
            providerFailure(completion.data.error.message, undefined) ??
            "The provider could not complete this request. The room owner can inspect its private session for details.";
      }
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
