# Work Together audit — 2026-10-09

Inspected timmoshu/bb main 0f53aacbec1a46680e6aa392408ad7f8d1333c87 and feature/room-distribution-adapter. Main diverges from current get-bb/bb by 23 ahead / 1210 behind at audit time. The previously discovered upstream PR2324 was filed accidentally against upstream and closed; it points to the downstream fork.

Main implements deterministic coordination-thread bindings, integration-token authentication, digest-checked context envelopes and filespace/settlement integration. It is a BB execution cell for separate Work Together MCP/web/worker services, not a self-contained room frontend. Its release runbook explicitly excludes deploying those companion services.

The room-distribution-adapter branch implements signed principal assertions, pinned verification keys, request/method/transport binding, membership revisions, replay guards, authority checks for commands and websocket reauthorization. A binding-scoped room port exposes bootstrap, execute, events and subscribe. Its stream target chooses a primary thread or child attachment; this does not establish arbitrary peer-agent participation in one room. Tests cover policy and transport boundaries but have not been run here.

Reuse the architecture lessons (explicit identity; room authority; durable stream cursors; execution identity separate from social identity), not a blind cherry-pick of a heavily diverged integration. Build on current upstream in csells/bb's rooms branch with independent persistent BB threads per agent and a room log above them.

Sources:
- https://github.com/timmoshu/bb/tree/0f53aacbec1a46680e6aa392408ad7f8d1333c87
- https://github.com/timmoshu/bb/blob/main/apps/server/src/routes/work-together-coordination.ts
- https://github.com/timmoshu/bb/blob/main/docs/bb-candidate-cell-release.md
- https://github.com/timmoshu/bb/blob/feature/room-distribution-adapter/apps/server/src/auth/work-together-principal-policy.ts
- https://github.com/timmoshu/bb/blob/feature/room-distribution-adapter/apps/server/src/room-distribution/room-distribution-port.ts

Upstream multiplayer PR799 is unmerged and uses explicitly claimed rather than authenticated identities. Its UI/presence ideas are useful, but its authority model does not satisfy separate verified people.
