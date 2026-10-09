# Rooms replacement checkpoint — October 9, 2026

The thread is in `/Users/csells/code/Forks/get-bb/bb-rooms`, branch `rooms`, fork `csells/bb`. Use `git log` and registry record `bb-rooms-stage` for the exact revision. The user authorized replacing this disposable preview and using Codex and Claude. Stable BB and Buzz remain unchanged.

## Architecture and implemented behavior

BB manages every agent's project, environment, persistent top-level thread, provider session, tool execution, steering and cancellation. Rooms uses BB's SDK; it has no independent provider runner or direct vendor conversation path. Rooms adds authenticated human and agent membership, durable targeted deliveries and explicit public participation.

Agents publish deliberately through activation-scoped CLI/API operations. Private final text, reasoning and tool telemetry never become chat automatically. Independent agents retain their own authorship. Public streams use begin/append/commit/abort; optional notices permit silence. Structured recipients replace regex handoffs. No hidden two-handoff cap or coding-only topic restrictions remain. SDK and human CLI expose the same room operations.

Immutable native request/acceptance/terminal proof controls execution leases; idle alone is insufficient. Every live steering submission is persisted before dispatch with exact text and thread/activation binding. Missing acknowledgments fence publication and retain the lease without replay. Recovery and ordinary native interruption preserve never-dispatched human follow-ups; explicit Rooms Stop cancels active and queued work.

## Verified

Final Turbo build/typecheck and 26 Rooms tests passed. The unchanged human CLI previously passed 857 tests with one skip, and four copied-agent-CLI subprocess checks passed. Codex `gpt-6.1-sol` and Claude Code `claude-opus-5-5` each passed 15 natural runtime checks: independent top-level agents, conversation beyond two handoffs, silence, genuinely authored public chunks, restart without replay, actual native steering with observed effect and Stop during active composition. An independent audit confirms both native steering receipts were `sent`.

Four actual-BB/Codex transport-fault scenarios passed 7/7/6/5 checks, and the native interruption red/green regression passed five. Final Chromium and WebKit each passed 12 synthetic UI groups, covering pending/error/stream states, granular permissions, steering controls, drawers unresolved execution remaining visible behind queued input, and preservation of budget edits across delayed snapshots. Actual iOS Safari previously verified the touch-input and keyboard-drawer fixes; it was not rerun for the later logic-only UI changes.

The final artifact passed all twelve mixed Codex/Claude conversation/control groups and separate Codex and Claude public-stream cases. Both original signup-authenticated human browsers observed at least three growing in-progress text states and same-ID completion for each provider. This is combined evidence from separate runs, not one uninterrupted fourteen-group suite. A real owner command approval also passed through the UI. The earlier budget draft race was reproduced and fixed; observer instrumentation and approval-wait timeouts remain preserved as test failures. All 23 product source hashes match the tested VM after the final UI correction. The earlier Pi public suite passed twelve groups. Do not count synthetic snapshots or supplied chunks as natural composition. See the [validation report](../../validation/rooms-v2/README.md) for exact evidence and build scopes.

## Corrected diagnosis

A deeper recursive trace found actual Bash requests in early run 6. The copied compiled CLI silently exited 0 because its entrypoint guard compared macOS `/private/var` to `/var`. A dedicated executable entry module fixed the issue; actual copied-bundle regression and subsequent natural conversation passed. Earlier model-incapability attribution was premature. Later local-model streaming failures were real and remain preserved alongside successful Codex/Claude traces.

## Staging operations

Only the primary disposable Rooms VM remains running. Candidate source/runtime, data and agent workspaces are inside that VM; the temporary Safari VM was deleted after evidence export. Host services provide HTTP relays only. The registry is authoritative for endpoints, lifecycle and cleanup. [Hosting evidence](../../validation/rooms-v2/hosting.md) documents turn-independent launchd service lifetime and manual VM/temporary-tunnel recovery limits.

The owner-only initial claim is `https://csells-mac-mini--51989.getbb.app`; it points to replacement data and the invitation remains unconsumed. Workshop is configured with Atlas on `codex/gpt-6.1-sol` and Nova on `claude-code/claude-opus-5-5`. The main Workshop has no QA history; acceptance uses separate rooms and identities.

Chris explicitly approved private credential transfer and provider use. Codex and Claude authentication is installed in the disposable VM, with source credentials unchanged. Do not request the same approval again. Remove task-added credential files and any guest provider Keychain entries at teardown, following [provider preparation](../spikes/provider-preparation/README.md). Do not copy refreshed guest credentials back. Separate agent directories under one OS account provide no hostile-agent isolation; this preview is for trusted collaborators.

Migration `0144_high_young_avengers.sql` is stable and applied; do not rename it. Final source hashes match 23 product files between this checkout and the tested VM. Stable installation merge or promotion still requires separate explicit approval.
