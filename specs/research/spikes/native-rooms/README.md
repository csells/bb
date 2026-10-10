# Native BB Rooms qualification

October 10, 2026. The native preview is hosted in the task-owned disposable VM. Exact hosted fixture cleanup and actual iOS Send-button persistence verification passed. The [cutover](cutover.md) preserved the existing Workshop, login and agent bindings. No stable installation is changed.

The candidate serves the actual BB application through an authenticated edge. Explicit operators retain BB's normal shell and APIs; invited room guests use the same room view without initializing private BB queries or sockets. A room adds conversation membership and public messages. Projects, environments, threads and sections retain their existing BB meanings.

## Evidence obtained

- [Original owner login](evidence/hosted-owner/evidence.json): the existing password opens the native Workshop, the original Atlas thread renders through BB's real route, both agent bindings remain intact, and New room exposes project and section controls.
- [Access boundary](access.md): real HTTP, binary upload, WebSocket and SSE tests cover operator/guest separation, forged trusted headers, origin protection and live revocation.
- [Bindings](bindings.md): new agents share a selected BB project/environment. Attaching an existing thread preserves its identity, options, event history and workspace instructions. All execution uses BB's SDK.
- [Migration rehearsal](evidence/migration-rehearsal.json): the real migration ran on a read-only online backup. All 47 old rows across 13 room tables remain identical, including public history, authentication records, receipts and Atlas/Nova bindings. No dispatcher ran against copied work.
- [Native browser UI](../native-bb-rooms/ui/browser-green-3/result.json): actual room and BB section creation, invitations, two independent humans, persistent attribution and compact layout pass. Screenshots were visually inspected. Actual thread, file preview, terminal commands, diff, plugins and Settings also pass; see the [resource checks](../native-bb-rooms/ui/README.md). Chromium and WebKit pass. Actual iOS Simulator Safari also passed room/section creation and persistent, accessible drawers after exposing and fixing a keyboard scrolling defect; the [iOS report](ios/RESULTS.md) records exact coverage.
- [Hosted live dialogue](evidence/hosted-dialogue/evidence.json), following the [isolated candidate dialogue](evidence/dialogue-2/evidence.json): two independent signed-in humans and real Codex/Claude participants used the native UI. Each agent published under its own identity; an undirected question reached both as optional context and received useful replies. Each provider streamed multiple growing public states to both browsers. Explicitly ending the discussion produced two silent completions, and reload preserved history. [Observed stream states](evidence/hosted-dialogue/stream-observers.json) retain the actual transport observations; screenshots show rendered partial replies.
- [UI regressions](ui-review.md): saved environment retention, account isolation, recovered transport errors, pending approval visibility and draft preservation have focused checks. The combined app run passed 45 tests; sidebar integration passed eight; all 38 Rooms package tests, its typecheck and build passed after the machine transport repair.

## Failures that changed the implementation

The existing runtime assumed each project belonged to one room agent. Native shared projects required activation-specific recovery. A stale Stop must carry an expected turn ID all the way into the runtime lock; otherwise a delayed cancellation can kill a successor.

The first real scoped Stop test interrupted the provider correctly but left BB's thread marked active. Focused tests had missed the server lifecycle transition. A regression reproduced the active status, and the repair admits a confirmed interruption from active while rejecting completion effects from an older turn. The [real retest after restart](evidence/real-scoped-stop.json) passed: queued/stale stops preserved unrelated work and the current stop interrupted its turn and returned its thread to idle. The initial failed evidence remains in `evidence/real-bindings.json`.

The first dialogue browser driver used exact implicit select labels; option text made that selector fail before any provider turn. The corrected driver uses the inspected combobox name. This was a driver failure, not a passing interaction.

## Remaining qualification

Machine enrollment, CLI parity, migration cutover and hosted two-human/two-agent dialogue pass. [Exact fixture cleanup](cleanup.md) preserved Workshop's full pre-cleanup rows, owner account and sessions. Actual iOS Send publication cleared the composer, returned HTTP 200 and persisted exactly one human message in SQLite; injected XCTest newlines were not treated as proof of submission. Qualify the separately authorized long-lived Claude token; the failed [Keychain spike](../native-bb-rooms/credential-storage/README.md) does not establish unattended renewal.

The first edge blocked machine enrollment; the [machine transport repair](machine-transport.md) now passes real credential-verifier/HTTP/WebSocket checks, and [actual packaged daemon enrollment/RPC](access-evidence/machine-acceptance.json) passes. Seven [Rooms CLI operations](access-evidence/cli-acceptance.json) also pass against the gateway, including room context and existing-thread attachment. The [lifecycle review](lifecycle-integration.md) found that combined server move, export/restore and stock packaging are not implemented. Explicit refusals prevent incomplete operations in native separate-service mode. Every plugin/OAuth integration is not exhaustively qualified, and no full-BB lifecycle parity claim is made.

The executable probes are [migration rehearsal](rehearse-migration.ts), [bindings](prove-bindings.ts), [scoped Stop](prove-scoped-stop.ts) and [native dialogue](dialogue.browser.mjs). They run only against isolated candidate ports/data, use private credential files and retain failures as evidence.

## Final artifact and service cleanup

All 91 changed product source/configuration/test files match the tested VM; see [source hashes](evidence/final-source-sha256.json). Independent QA core, daemon and gateway ports are closed, their two LaunchAgents are archived outside autostart, and both owned iOS simulators and the temporary proxy were removed. The hosted core, daemon, gateway and tunnel remain available. Provider credential copies stay only in private guest storage for the preview and must be removed at VM teardown.

Exported text logs have trailing spaces and excess blank lines at EOF removed for repository hygiene; diagnostic text and results are retained. Original runtime logs remain in the private VM QA directory until teardown.
