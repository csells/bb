# Rooms replacement checkpoint — October 9, 2026

The thread is in `/Users/csells/code/Forks/get-bb/bb-rooms`, branch `rooms`, fork `csells/bb`. This checkpoint accompanies the explicit-participation replacement commit; use `git log` for its revision. The user authorized replacing the disposable preview and requires real multi-human/multi-agent verification. Stable BB and Buzz remain unchanged.

## Implemented and verified

The replacement removes transcript mirroring, regex handoffs and the hidden two-handoff cap. Agents deliberately publish through scoped CLI/API operations, with independent persistent top-level BB threads, durable per-agent execution leases, idempotency, public stream lifecycle, publication fencing and successful no-public-reply completion. Humans use separate authenticated sessions and structured recipients. SDK and human CLI expose the same operations. There are no code-only topic restrictions.

BB admission proof correlates immutable activation markers with durable requested/accepted/terminal events; idle alone is insufficient. Successful native queue cancellation has a separately persisted receipt. Missing proof holds the execution lease, shows an explanatory status after a grace period and never automatically replays dispatch.

Final Rooms build/typecheck and 24 tests passed, as did four actual copied-CLI subprocess checks. The broader CLI suite passed 857 tests with one skip. Fourteen controlled native lifecycle checks passed, including public stream revisions, restart without replay, real live steering, Stop and stale-capability rejection. Five actual native status-recovery checks passed.

Natural dialogue run 7 passed six checks, including independent author identities, parentless BB threads, more than two peer handoffs followed by idle, and optional silence. The final public HTTPS browser run passed all twelve groups on the final prompt/build with two humans and two actual Pi agents. It includes natural peer dialogue, optional silence, a busy follow-up queue, Stop, visible budgets, owner-only activity, reload and compact layout. Final minified Chromium/WebKit pending/error/stream/drawer checks passed. Actual iPhone 17 Pro / iOS 27 Safari found and verified fixes for input focus zoom and keyboard drawer sizing. Evidence is indexed in [the validation report](../../validation/rooms-v2/README.md).

## Remaining qualification

**Natural model-authored streaming has not passed.** One post-fix instruct-model attempt passed an unsupported incoming message ID to stream begin, then wrote privately. A fresh thinking-model attempt finished with zero tool calls and zero public messages. The private fallback was correctly excluded. Controlled stream fixtures establish protocol behavior, not autonomous composition. Do not claim full requested qualification is complete.

Codex 0.159.1 and Claude Code 2.1.293 are installed in the VM but unauthenticated. The asynchronous permission question about copying existing authentication remains unanswered; no personal credentials were read or copied. Continue strong-provider qualification if permission arrives, using the private-transfer procedure in [provider preparation](../spikes/provider-preparation/README.md). Do not infer permission from the preselected option.

## Corrected diagnosis

Run 6 did execute a nested Bash request with its own philosophical question. The earlier shallow timeline inspection missed it. The copied compiled CLI silently exited 0 because its entrypoint guard compared `/private/var` to `/var`. A dedicated executable entry module fixes the issue; the actual copied-bundle regression and subsequent natural conversation passed. Actual HTTP metadata confirmed Bash was advertised. Preserve the raw failures and corrected explanation; do not attribute this executable defect to model incapability.

## Staging operations

Only the primary disposable Rooms VM remains running; the temporary Safari VM was deleted after evidence export. Candidate source/runtime, data and agent workspaces are inside the VM. The central registry record `bb-rooms-stage` is the authoritative source for current endpoints, source revision, lifecycle and teardown instructions. [Hosting evidence](../../validation/rooms-v2/hosting.md) documents turn-independent launchd service lifetime and the unsupervised VM/temporary tunnel restart limitation.

The owner-only initial claim is `https://csells-mac-mini--51989.getbb.app`; it points to replacement data at the current public origin, with the owner invitation unconsumed. Workshop is preconfigured with Atlas and Nova using `pi`, model `rooms-local/qwen3:4b-instruct-2507-q4_K_M`, and the general perspectives verified by the public browser suite. Separate directories under one OS account provide no hostile-agent isolation; this preview is for trusted collaborators.

## Continue

Finish natural streaming qualification with a suitable approved provider, preserve actual public stream evidence, and update these reports. If product code changes, rebuild and verify the affected candidate inside the VM and sync the fork. Do not silently narrow the target to passing controlled fixtures. Stable BB merge/promotion requires separate explicit approval.
