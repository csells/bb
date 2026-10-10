# Native room bindings and migration

Status: October 10, 2026. Source research led to the implementation and VM regression checks recorded below. Migration rehearsal and real-provider acceptance remain separate qualification steps; their prepared probes are described in `acceptance-probes.md`.

## What exists

A room currently has no BB project, environment or section. A participant stores an optional project ID and thread ID. On its first activation, `RoomRuntime.prepare` creates a local directory and a separate project named after the room and agent. It writes its own `AGENTS.md` into that directory before every activation. `run` then creates a BB thread using the new project's default environment. Subsequent activations send to that same native thread. Existing public messages and delivery receipts are stored separately from the BB thread transcript.

This preserves independent agents and private execution, but it does not make room agents work in the user's selected BB project. Simply swapping the project ID would also risk overwriting the project's real `AGENTS.md`.

The participation instructions are already repeated in the activation prompt. Installing a project-level instructions file is unnecessary for a bound thread and must stop before adopting real project environments.

Source: `apps/rooms/src/runtime.ts` (`workspace`, `install`, `prepare`, `prompt`, `run`), `apps/rooms/src/store.ts` (`createRoom`, `addAgent`, `saveAgent`), `packages/domain/src/rooms.ts`, and `packages/db/src/schema.ts` (`sharedRooms`, `roomAgents`).

## BB primitives already available

`threads.spawn` accepts a BB project, a thread section and BB's existing environment selection contract: project default, reuse an environment, select a host/path, or use an environment provider. `threads.get` exposes the participant's actual project/environment/provider. This avoids inventing a second environment system or changing the host protocol.

`environments.get` identifies the environment's host and path. `threads.storageLocation` resolves private thread storage on the actual execution host. `files.write` and `files.remove` already perform host-routed file operations. `hosts.get` includes the host's thread storage root. These are alternatives to assuming that the room gateway's filesystem is also the execution host's filesystem.

Thread sections are native BB objects through `threadSections.list/create/update/delete`. Room placement should reference these sections; a room must not masquerade as a provider thread merely to enter the sidebar.

Sources: `packages/sdk/src/areas/{threads,environments,files,hosts,thread-sections}.ts`; `packages/server-contract/src/api/{threads,shared}.ts`; `packages/domain/src/{thread,environment}.ts`.

## Proposed minimum contract

A room needs a project association, a default execution environment for new agents, and native sidebar placement. Use `projectId`, `environmentId` and `sectionId` as references, with absence meaning an explicitly unassociated legacy or general conversation room. Do not silently populate an unrelated project for each participant. A room's selected environment supplies a default for new threads; it does not relocate existing bound threads.

Adding an agent must support either creating a new independent native thread in the chosen context or binding an existing thread. Resolve and validate the project/environment/provider from BB at the server boundary. The browser must not be able to assert those properties for another thread. The operator authorizes binding a thread and exposing its public participation; room membership alone does not authorize private transcript access, files, terminals, provider configuration or attaching arbitrary operator threads.

For a new agent, retain normal BB execution defaults unless the user selects an override. Do not force `accept-edits` merely because it is a room agent. Once a native thread exists, its native configuration is authoritative; room metadata must not silently reset the model/provider/permissions on each room activation.

Retain the participant's stable room identity separately from its thread. One thread must not be bound to multiple independently activated participants without a thread-wide lease. The simplest initial invariant is one active room participant binding per thread; reject duplicate binding at the persistent boundary. Existing uniqueness of activation per agent is insufficient if two agents share a thread.

For an existing bound thread, generate the activation-specific CLI and capability in BB-managed private storage on its execution host. Do not modify workspace `AGENTS.md`, repo files or an existing project's source registration. Only explicit tool/CLI publication reaches the room. The command's room/author binding remains server-controlled and fenced by the activation epoch.

The runtime must resolve changes to a thread's environment before a new activation. It must not run the command on a different machine from the provider. An unreachable command endpoint or unsupported host should fail visibly before dispatch, never fall back to a stable host. Remote capability installation and room endpoint reachability require a real-host spike before claiming general cross-host support.

## Migration invariants

Preserve room IDs, user IDs, membership, password hashes, session rows, invite rows, public message IDs/order/content/author IDs, delivery and publication receipts, agent identities, thread IDs, project IDs, activation state and steering receipts. A migration must not replay historical messages. It must not reparent existing Atlas/Nova threads or re-create them under new identities.

New associations are additive. Existing agent threads may initially remain in their old projects while the room gains native navigation; the UI should display the actual context rather than claim they share an environment. Moving a thread later is an explicit BB environment action with existing semantics.

If room tables move from the gateway database into BB's main database, copy all room tables in a single transaction preserving values and relations, then qualify counts and deterministic content digests before switching the writer. Do not run two dispatch loops against copied activation tables. Quiesce/fence the source and ensure no uncertain activation is replayed. Keep a recoverable source copy and the same public identity/session mapping.

If the gateway remains an internal room service while the full BB server mounts its UI/API, no data copy is needed. The owner-only BB transport credential must remain server-side; a member session cannot become a BB operator bearer merely because the view is native. This option avoids a rushed destructive migration but still needs server-enforced API and realtime authorization.

Schema changes must be expressed in Drizzle and generated migrations/snapshots; no hand-edited snapshot. Adding room references does not alter the server/daemon wire contract when existing BB APIs perform execution. If new wire fields become necessary, apply the repository protocol-version rule.

## Qualification required

1. Existing room, identities, history, receipts and exact Atlas/Nova thread bindings survive unchanged; old messages are not replayed.
2. In the normal BB app, create a room in an existing project/environment and native section. Create two agents there. Both native threads have the chosen context, and the project count does not grow per agent.
3. Bind an existing idle thread. Its provider/model/settings/history remain intact. A duplicate thread binding and unauthorized binding fail before any dispatch.
4. Hash the repository's `AGENTS.md` and working tree before and after participation. Room capability setup does not change them. Capabilities live in private storage and are revoked/deleted on settle and stop.
5. Use the actual thread view for files, terminal, diff, provider/model controls and lifecycle; these are existing BB paths, not copied room controls. Exercise normal human thread input as well as room deliveries without two concurrent activations or duplicated steering.
6. Two independently authenticated humans participate; a member cannot read unrelated threads or invoke unrelated file/terminal operations. Revocation affects established subscriptions.
7. Real Codex and Claude publish independently through the room CLI, stream selected text, choose silence, receive steering exactly once, and recover without private transcript mirroring.

## Implementation checkpoint

The bindings slice now adds room `projectId`, `defaultEnvironmentId` and `sectionId`, participant `environmentId`, and persistent activation credential locations. Migration `0145_native_rooms_bindings.sql` was generated by Drizzle inside the disposable candidate VM; it adds nullable columns and a unique participant-thread index. It does not copy or rewrite existing room records.

New agents require an associated BB project. An explicit room environment is reused; otherwise the project's default source checkout is used through BB's host/unmanaged environment selection. Existing threads can be attached by thread ID, retain their native model/provider/environment and do not run a turn merely by being attached. Existing participants are not moved when the room association changes. The runtime installs activation-scoped files through BB's host file APIs under private BB storage and no longer writes project `AGENTS.md` or creates per-agent projects. Loopback participation endpoints require the explicitly configured local execution-host ID.

Four focused VM tests passed: association preserves history, native binding and publication receipts without replay; duplicate thread binding is rejected across rooms; stopping queued room work leaves unrelated native work alone; creating an agent without project context fails instead of creating an unrelated project. The queued-stop regression failed with the actual old Stop method, then passed after repair. Logs are under `evidence/native-bindings-{red,green}.log`. This is not yet real-provider or rendered UI qualification of native integration.

Attaching normal BB threads exposed another old assumption: recovery previously stopped every thread in an agent's private project. Recovery now inspects exact activation markers and only addresses matching room work. Stop also needs an atomic turn identity guard, since checking native activity then issuing an unscoped Stop can still interrupt a successor. The implemented core API/daemon/runtime guard and its regression evidence are described next.

## Turn-scoped Stop

The existing Stop API now accepts optional `expectedTurnId`; CLI callers use `bb thread stop ID --expected-turn TURN_ID`. Rooms derives the intended turn IDs from exact activation/steering admission receipts and uses this form for stop and recovery. A stale scope is a successful no-op. General BB Stop retains its existing thread-wide behavior.

The server checks the expected turn before issuing any command. The daemon passes that identity directly to the runtime without stopping another environment or waiting for a successor to start. The runtime checks identity synchronously before cancelling tools or sending provider Stop. Scoped command completion does not perform thread-wide finalization or dismiss a successor's interactions; the intended provider completion event drives the normal lifecycle. Scoped Stop intentionally does not revoke a thread-wide browser lease, because the lease may also belong to later independent work. The owner can still use BB's general Stop for thread-wide cleanup.

The regression was reproduced with the previous runtime Stop implementation: asking to stop the earlier turn interrupted its successor. After the guard, 20 runtime command-contract, 7 tool-call, 39 daemon command-dispatch and 26 server Stop tests passed in the candidate VM. The tests exercise matching Stop, stale successor protection, tool cancellation ordering, cross-environment isolation, exact wire scope, and a late Stop result arriving after a successor starts. The server/daemon protocol version is 231 for this wire addition. Test logs are under `evidence/native-stop-*.log`.

The final scoped-Stop source also passed Turbo typechecks for `@bb/rooms`, `@bb/cli`, `@bb/agent-runtime`, `@bb/host-daemon` and `@bb/server` inside the candidate VM. The same runtime `stopThread` implementation handles scoped and ordinary Stop; ordinary thread-wide Stop regression coverage remains green. No provider sessions or current preview data were changed by this slice's verification.

## Migration rehearsal result

The real preview database was opened read-only and copied with SQLite online backup into the isolated native QA directory. Applying the candidate's actual migration 0145 through `@bb/db` preserved every old column of every room table: 13 tables and 47 rows, including 7 public messages, 4 humans, 6 sessions, 9 deliveries, 9 activations and 7 publication receipts. All deterministic before/after digests match. SQLite integrity and foreign-key checks passed; all newly added fields remain null.

Atlas retains project `proj_izypxtcyp3` and thread `thr_fbhp67gj3i`; Nova retains project `proj_i7ciwcjdfg` and thread `thr_ghwyvj3ihy`. Room, user, membership, message and participant identities are recorded in `evidence/migration-rehearsal.json`. No RoomRuntime or dispatcher opened the copy, so migration could not replay historical work. The live database was not migrated or written. The copied database contains private data and remains in the disposable VM for teardown; only the sanitized evidence report was exported.

## Real native binding spike

Against the fresh candidate core on port 38896, the probe attached an existing Codex thread without changing its 22 prior events, execution settings, project/environment identity or workspace `AGENTS.md`. Duplicate attachment was rejected. New Codex and Claude participants then produced separate public CLI contributions, both in the existing room project and environment. No per-agent projects were created. Seven deliveries settled: two public replies and five deliberate silent completions. Existing native settings and `AGENTS.md` remained unchanged after participation.

The same run exposed a lifecycle bug that the initial scoped Stop tests missed. Cancelling queued room work and sending a stale scoped Stop both preserved unrelated native work. A matching scoped Stop interrupted the native turn immediately, but the server still displayed it as active: the lifecycle table only accepted a confirmed Stop from `stopping`, and scoped Stop had correctly avoided setting thread-wide stopping state beforehand. The initial report is retained as failed evidence in `evidence/real-bindings-initial.json`; it is not an uninterrupted acceptance pass.

A new route-plus-provider-event regression reproduced this failure (`native-stop-completion-red.log`). The fix permits a confirmed Stop to settle an active thread and requires the completed turn to match the latest root turn before applying its status effects. A delayed earlier completion therefore cannot settle a successor. The repaired Stop and event-ingestion suites passed 50 checks, lifecycle/diagram suites passed 13, and server/domain typechecks and the candidate server build passed.

After the coordinator restarted the candidate core, the focused native Stop rerun passed (`evidence/real-scoped-stop.json`). It admitted a real successor turn, preserved it through queued Room Stop and stale scoped Stop, then interrupted exactly that turn and returned its BB status to idle. Matching Stop settled in about 230 milliseconds in this run. The fixture room remains paused, with its remaining queued deliveries explicitly cancelled. This is a separate passing rerun, not a rewritten claim that the original run passed.

Read-only credential cleanup inspection also verified all seven room activations settled and revoked, all credential-location fields cleared, no capability JSON left on disk, and three CLI files installed outside the workspace in private execution-host storage with mode 0700. See `evidence/real-credential-cleanup.json`.
