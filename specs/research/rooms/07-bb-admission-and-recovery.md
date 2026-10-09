# BB admission and recovery need durable turn evidence

Implementation review found a gap that a successful chat demo would miss: a BB thread reporting `idle` does not prove that a particular room activation finished. The replacement must correlate its activation with BB's persisted request and provider-turn events before releasing its execution lease.

## What the current BB source establishes

The audited base is `a05bc0eea5ede0ffe2a99cf607c55e1afef43e34`. `packages/server-contract/src/api/threads.ts` and `packages/sdk/src/areas/threads.ts` expose spawn and send without a caller-selected admission idempotency key. A send returns either a sent receipt or a durable queued message. The server assigns its own request ID during admission, after asynchronous preparation. A lost HTTP response therefore cannot safely be interpreted as rejection, or retried blindly.

`apps/server/src/services/threads/thread-lifecycle.ts` stops current execution, but pending queued messages have their own lifecycle. A project scan showing idle threads is insufficient evidence that a previously timed-out request will never arrive or that a queued message is gone. Recovery must inspect matching queued input as well as running execution.

These are source findings, not a claim that native BB provides a distributed exactly-once dispatch protocol. Rooms deliberately preserves an uncertain state when it cannot establish what happened.

## Correlate a room activation with trusted native events

Each room activation's private prompt contains an exact immutable activation marker. Inspect it only in a typed `client/turn/requested` event's input, never in arbitrary agent output. That event supplies BB's request ID. A `turn/input/accepted` event relates the request to a scoped provider turn. A later `turn/completed` for that same thread and turn proves completion; a matching `client/turn/rejected` proves rejection.

Relevant definitions are in `packages/domain/src/thread-events.ts` (`turnRequestEventDataSchema`, `turnRequestRejectedEventDataSchema`) and `packages/domain/src/provider-event.ts` (`turn/input/accepted`, `turn/completed`). The SDK exposes persisted events and queued-message list/delete operations. A request marker without acceptance/completion remains unresolved. Multiple observed requests for the same activation must all have terminal evidence.

The admission helper and focused failure tests live in `apps/rooms/src/admission.ts` and `apps/rooms/test/admission.test.ts`. They distinguish absent admission, a request waiting for acceptance, a running provider turn, completion and rejection. Private text containing the marker and unrelated or earlier completion events cannot settle an activation.

## Consequences for Rooms

Acquire the database activation lease before creating an agent project or preparing execution. Otherwise competing dispatchers can create different projects and overwrite the trusted binding before one submits work. Re-read the agent binding after claiming the lease.

Keep busy follow-ups in the room's durable inbox. Honor BB's queued receipt and inspect corresponding native queued input. Stop fences public publication immediately; cancel matching queued native input and request runtime termination separately. Public-writing revocation is not proof that an OS process has stopped.

A known accepted activation can reconnect after a gateway restart. An uncertain dispatch is never automatically replayed. An owner's explicit recovery action must establish native admission and terminal evidence before releasing the uncertainty; missing evidence produces a visible error rather than a false success. This design retains the useful distinction between “cannot publish” and “has finished executing.”

Final real-provider acceptance must exercise this integration. Unit event fixtures alone establish the helper's rules, not the provider adapter's emitted events. See [verification](06-verification.md) for executed results and remaining gates.
