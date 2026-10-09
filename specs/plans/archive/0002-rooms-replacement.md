# Replace transcript mirroring with room participation

Status: complete — October 9, 2026. The replacement is hosted in disposable staging and verified with two humans, Codex and Claude. Stable-installation promotion remains separate.

The user authorized replacing the hosted preview. Proceed in the disposable VM; the disposable preview may be replaced from a fresh state. This plan does not seek renewed permission to implement the candidate. Stable-installation promotion remains outside this work until explicitly approved.

## Phase 1: close the protocol spikes

Complete [0001](0001-rooms-participation-spikes.md) with deterministic failure fixtures and real independent provider execution. Resolve identity binding, immutable activation fencing, no-post settlement, busy-input handling and selected public streaming. Keep the scratch protocol disposable; adopt only behavior backed by evidence. The controlled broker spike completed; its supplied-command sequences establish mechanism, not autonomous behavior. Natural production-provider acceptance was a separate gate and subsequently passed with Codex and Claude; see the final checkpoint below.

## Phase 2: add durable identities and deliveries

Implement stable human/agent principals and memberships, private provider bindings, immutable activation records, per-agent inboxes, idempotent publication receipts and an atomic message/outbox transaction. Separate runtime permission policy from room participation. Add trusted native tool or scoped CLI/MCP access over the same schema-validated API. Do not authenticate from mutable thread metadata or model-supplied author fields.

The user explicitly discarded the existing preview, so migration of its chat records, configuration and workspaces is not required. Start fresh where useful and remove authority derived from mirrored transcript rows. Credentials must be scoped and revocable. Document the isolation guarantee honestly if agents share an OS identity.

## Phase 3: replace execution-to-chat coupling

Remove assistant/tool transcript mirroring, regex `[[ask]]` dispatch and hidden causal-depth suppression. Dispatch durable targeted requests and optional notices into independent private sessions. Require explicit public publication; allow successful silence. Queue busy input or steer only through supported acknowledged provider operations. Fence stale/canceled workers and make operational pause reasons visible.

Implement public stream begin/append/commit/abort with ordered revisions, authenticated ownership and final-only recipient activation. Provide a separate permissioned execution activity view. Complete actual provider streaming integration; do not substitute private telemetry mirroring.

## Phase 4: make the room understandable

Expose participant identity, structured `@` selection, invitation, agent capability status, queued/working/waiting/idle states and visible pending response before first text. Let two humans continue typing while multiple agents work. Offer explicit ask/notice or equivalent clear interaction semantics without exposing backend jargon. Stop/Pause controls act on documented scopes; resource limits report why work paused and how to resume.

## Phase 5: verify and replace hosted staging

Run the integrated candidate end to end with two independent human browser sessions and two independent real agents. Verify negative publication tests, peer dialogue beyond two exchanges, silence, concurrent human input, streaming/reconnect, retries, restart, revocation and cancellation. Validate the actual public URL as well as VM-local service behavior. Preserve sanitized evidence and update research/acceptance status.

Replace the disposable preview after these candidate checks pass. Retain research and test evidence; migration or rollback investment for the discarded preview is not required. The user has already authorized this preview replacement. Report the tested provider/model combinations and any remaining concrete limitations. Do not merge or promote into the stable BB installation under the guise of updating staging.

## October 9 final checkpoint

All five phases are complete for the trusted-collaborator preview. BB continues to own agent execution; Rooms provides identity, durable delivery and explicit CLI publication. The hidden handoff cap and transcript mirroring are removed. Final build/typecheck and 26 Rooms tests passed. Codex and Claude each passed fifteen natural lifecycle checks, including authored public streams, native steering, restart and Stop during composition. Actual transport faults and interruption regressions verify exact admission proof and preservation of queued human input.

The final hosted artifact passed twelve mixed-provider conversation/control groups and separate Codex and Claude streaming cases observed in both signup-authenticated human browsers. This is separate-run evidence, not one uninterrupted fourteen-group suite. A delayed-snapshot budget draft defect was reproduced and fixed; final Chromium and WebKit each passed twelve synthetic groups. Real owner approval also passed through the UI. Earlier failures remain preserved with their diagnoses. Actual iOS Safari had separately verified the touch-input and keyboard-drawer fixes.

Workshop is configured with Atlas on `codex/gpt-6.1-sol` and Nova on `claude-code/claude-opus-5-5`; QA rooms and humans were separate. Chris explicitly authorized private credential transfer and this preview replacement. Authentication remains in the disposable VM for review and must be removed at teardown. No stable installation has been promoted. See [validation](../../validation/rooms-v2/README.md) for evidence, source hashes, hosting and trust boundaries.
