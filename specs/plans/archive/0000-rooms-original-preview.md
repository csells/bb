# Shared human and agent rooms — superseded preview

Status: rejected and superseded by [explicit participation](0001-rooms-participation-spikes.md) and [the replacement](0002-rooms-replacement.md). Retained as historical evidence of the original design, including its discarded transcript mirroring and two-hop limit. This is not the current product contract.

Build a reviewable preview on current BB without importing the separately deployed Work Together service stack. Maintain the upstream BB runtime and use its SDK as the execution boundary.

A Rooms gateway authenticates humans, enforces room membership, persists attributed conversation and dispatches to one persistent BB thread and workspace per agent. The browser and CLI share an experimental SDK client. BB operator APIs remain private. This preview is for trusted collaborators: membership is an application access boundary, while agents inherit their provider's machine permissions. A room is not an operating-system sandbox.

Acceptance: two independent browser accounts; single-use invitations; authenticated attribution; concurrent messages; incremental output from two actual agents; real tools; persistent follow-up; deliberate agent handoff; stop/steer; recovery; revocation. Exercise the built candidate in a disposable VM. Do not promote stable installations.

Dispatch is durable and idempotent per originating message and recipient. Concurrent agents run independently; an individual agent processes its own queue serially. Ambiguous dispatch after a gateway crash is surfaced for inspection rather than blindly submitted twice. Agent-to-agent handoffs are explicit ask directives and bounded to two hops. Human mentions never silently invoke a default agent.

SSE supplies snapshots and reconnect replay. A short polling fallback delivers incremental output through event-buffering proxies. Presence is approximate, with short heartbeat leases. Raw credentials and invitation secrets must not appear in logs or Git.
