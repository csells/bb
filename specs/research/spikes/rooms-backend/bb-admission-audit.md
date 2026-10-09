# BB admission and uncertain dispatch

Source audit in the candidate checkout, 2026-10-09. No BB core changes are required for the proof helper. This is a source-derived protocol recommendation; the integration owner must verify it against actual provider events.

## No caller-chosen admission key

`packages/server-contract/src/api/threads.ts` defines create and send requests without a caller-chosen thread ID or idempotency key. SDK `sendJson` forwards no request identity. The sent response is only `{ok:true,delivery:"sent"}`; a queued response includes its durable queue row. `thread-send.ts` generates `createClientTurnRequestId()` after asynchronous preparation. Thread creation validates its project and awaits provider, environment and attachment work before inserting the thread record. The request path does not propagate HTTP disconnect cancellation into those operations.

Consequently, an empty project scan or an idle thread cannot prove a timed-out request will never become visible. Retransmitting the prompt or freeing the execution lease on this evidence would permit duplicate external actions. Native Stop handles the live/prestart runtime; it is not an atomic cancellation barrier for every queued or still-being-admitted request.

## Correlate actual input admission and terminal execution

The public SDK `threads.events.list` returns typed `ThreadEventRow[]`, supports ascending pagination with `afterSeq`, and filters by event types. Use:

1. `client/turn/requested`: `data.input` contains the actual submitted text; `data.requestId` identifies server admission. Match the unique exact `\nActivation: UUID\n` marker here, never in assistant output or rendered message text.
2. `turn/input/accepted`: `data.clientRequestId` links the request to `scope: {kind:"turn",turnId}`.
3. `turn/completed`: the same thread and turn scope, later sequence, proves terminal execution. Preserve `data.status` and `data.error` so a failed/interrupted provider is not reported as successful silence.
4. `client/turn/rejected`: the matching `data.requestId` proves rejection before provider acceptance. If acceptance is also present, require that accepted turn to complete.

Every observed matching request must settle. Missing request evidence remains missing; a request without acceptance/completion remains pending. Paginate all relevant events instead of assuming the latest page includes admission. Queue rows expose input under `.content`; a matching queue row proves pending work, not completed execution. Inspect or cancel matching rows and re-read admission before release.

The helper is `apps/rooms/src/admission.ts`. Tests parse fixture events through the actual BB domain schema. They cover private output containing the marker, unrelated request IDs, cross-thread/cross-turn and earlier completions, exact-marker matching, successful zero-output completion, failure outcome, explicit rejection, and multiple observed submissions. Execution results are recorded separately after the VM run.

Unknown admissions must retain an uncertain lease and show a clear error. Recovery can release a lease after correlated admission and terminal proof, or after a separate operator-controlled quiescence procedure that establishes no old server admission remains. Merely restarting the Rooms gateway does not stop a request already executing in the BB server.

## Successful queue cancellation is a distinct terminal receipt

The queue-delete path offers a stronger guarantee than a bare idle observation:

- `apps/server/src/routes/threads/actions.ts:388` checks the queue row's thread, calls `deleteQueuedThreadMessage`, returns 404 if it did not delete, and returns 200 only for deletion. Its plugin cancellation notification is not a persisted `client/turn/rejected` event.
- `packages/db/src/data/queued-thread-messages.ts:2166` deletes the queue row inside an immediate transaction, including a previously claimed row.
- `apps/server/src/services/threads/dispatch-attempt.ts:614` runs `consumeClaimedRows` before appending the request. The check and append share one immediate transaction; `consumeClaimedRows` throws if claimed-row consumption fails (`:672`). The pending-thread path performs the same consumption before changing lifecycle state and recording provisioning (`:749`).
- `packages/db/src/data/queued-thread-messages.ts:1531` requires every claimed ID and claim token to still exist before consuming the batch. A deletion that won first prevents admission. A dispatcher that won first consumed the row, so the subsequent DELETE cannot report success.
- The legacy queued-message path also consumes claimed rows before recording the request in one transaction (`apps/server/src/services/threads/queued-messages.ts:542`).

Therefore an acknowledged successful deletion of the exact activation's queued input is terminal pre-admission evidence for that queued submission. The Rooms store records that evidence in its existing durable receipt table, under a separate queue-cancellation scope bound to activation ID, native thread ID and queue message ID. Recording requires the activation already be fenced with Stop requested; it does not itself free the execution lease.

Runtime may settle a stopped activation with no observed request event only when this matching cancellation receipt exists, no matching native queue row remains, and the native thread is terminal. A pending admitted request still requires its own terminal proof. Failed DELETE, 404, or a lost response is not recorded as successful cancellation. A crash after native deletion but before persisting the success receipt remains ambiguous rather than fabricating durable proof.

The upstream DB deletion and claimed-row tests were inspected, not rerun during this audit. The replacement store's added persistence test exercises receipt durability and identity binding with real SQLite; actual queued cancellation still needs the runtime acceptance scenario.
