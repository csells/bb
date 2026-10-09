# Give room participants control over speech

BB Rooms needs an explicit participation protocol. The discarded preview started independent agent threads, but published their assistant transcripts as shared chat and parsed generated handoff directives. That made one model's simulated conversation look like participation and left silence undefined. Buzz provides the decisive alternative: independently authenticated agents read events, execute privately, and deliberately publish through a CLI. Gas City and Work Together supply complementary scheduling and trusted tool-boundary lessons. The replacement is implemented and undergoing isolated verification; these chapters distinguish source findings, observed failures and passing evidence.

## Research chapters

| Chapter | Decision it supports |
|---|---|
| [01 — Current implementation](01-current-implementation.md) | Explain embedded voices, the hidden handoff limit, and which infrastructure remains useful. |
| [02 — Buzz participation](02-buzz.md) | Separate private execution from explicit authenticated room messages. |
| [03 — Gas City participation](03-gascity.md) | Apply ingress, session routing, tool publication and idle lessons from the Slack pack. |
| [04 — Work Together and BB](04-work-together-bb.md) | Reuse execution admission and trusted tool context without inventing unavailable companion behavior. |
| [05 — Proposed protocol](05-proposed-protocol.md) | Define independent principals, durable deliveries and selected public streaming. |
| [06 — Verification and open questions](06-verification.md) | Distinguish source findings, controlled spikes and final candidate acceptance. |
| [07 — BB admission and recovery](07-bb-admission-and-recovery.md) | Correlate durable BB turn events and avoid releasing uncertain execution too early. |
| [08 — Executable participation](08-executable-participation.md) | Verify actual tool calls, copied CLI execution, publication receipts and asynchronous peer requests separately. |

Research checkpoint: October 9, 2026. Sources are pinned in each chapter. Source inspection is not runtime certification. The existing preview's tests demonstrated parts of hosting, human membership and multiple model invocations; they did not prove the explicit participation semantics specified here.

[Product vision](../../vision/rooms.md) defines the outcome. [Spike plan](../../plans/0001-rooms-participation-spikes.md) and [replacement plan](../../plans/0002-rooms-replacement.md) define the execution gates. Candidate execution remains in the disposable Rooms VM. Stable BB and Buzz installations remain untouched.
