# Native Rooms lifecycle review

October 10, 2026. Read-only review of checkout `bb-rooms`, branch `rooms`, HEAD `e091800aba8c0e1cf5919dd2eca75b00ab4cbb82`, including current tracked and new native integration files. Upstream merge base: `3414fdaea7e9928cdaada0d9c1b75ee4b22bb7cf`. This is a focused lifecycle and access review, not an exhaustive review of the entire fork. No runtime or source behavior was changed for this review.

## Conclusion

The rendered operator experience is BB, but the application lifecycle is still two services. Room data, startup, authentication configuration and dispatch are outside BB's export, import, move, packaging and shutdown ownership. The current candidate cannot accurately claim every BB operation works for the combined application. The [machine transport repair](machine-transport.md) fixes enrollment transport and explicitly refuses a move; it does not solve this lifecycle gap.

There is a useful existing foundation: all `rooms_*` tables already live in [`packages/db/src/schema.ts`](../../../../packages/db/src/schema.ts) and normal BB migrations. The separate database is chosen by [`apps/rooms/src/server.ts`](../../../../apps/rooms/src/server.ts), which constructs `RoomsStore(ROOMS_DATA_DIR/rooms.sqlite)`. [`RoomsStore`](../../../../apps/rooms/src/store.ts) calls the same `createConnection` and `migrate` as BB. Native integration should use BB's owned database and lifecycle rather than add a second independently recoverable database indefinitely.

**Follow-up implementation checkpoint:** the requested interim core guard is now in source. A validated startup setting, `BB_ROOMS_SEPARATE_SERVICE=true`, makes core refuse ordinary export and move check/start with HTTP 409 and code `rooms_separate_service_lifecycle_unavailable`. It defaults off for ordinary BB. Three real app/database regression cases and the configuration validation case failed before this repair in the disposable VM. The repaired server cases and surrounding route/configuration tests passed: 17 server tests, 49 config tests with one existing skip, and the launcher's startup-only environment notice test. Logs are in [lifecycle-evidence](lifecycle-evidence/). Broader typechecking caught a scoped-Stop integration caller missing its newly required empty query object; that caller is repaired and the coordinator owns the typecheck/build rerun. The findings below describe the reviewed behavior before this guard. The guard prevents misleading/destructive operations when configured; it does not implement combined backup or migration.

## Confirmed gaps, ranked by impact

1. **High: a successful ordinary export is not a combined backup.** [`export.ts`](../../../../apps/server/src/services/server-move/export.ts) backs up `deps.db` to `bb.db`, then enumerates only [`server-owned-paths.ts`](../../../../packages/server-archive/src/server-owned-paths.ts). Room identities, passwords, sessions, messages, memberships, publication receipts and bindings are in the other database. The gateway forwards the normal export operation unchanged. Restoring that archive cannot restore Rooms. Documentation describes the gap, but the ordinary export control still produces an incomplete combined recovery artifact.

2. **High: the move refusal is an edge guard, not core policy.** [`NativeRoomsAccess.proxyHttp`](../../../../apps/rooms/src/native-access.ts) refuses the two move POST paths; [`routes/server-move.ts`](../../../../apps/server/src/routes/server-move.ts) and its coordinator have no Rooms capability check. A local native SDK/CLI call to core can reach the old move path. This is a consistency and data-preservation gap, not an unauthorized-access bypass: operators can already execute code. Source-checkout packaging may independently reject a move today, but that incidental condition does not enforce combined lifecycle correctness.

3. **High: the normal package cannot recreate this deployment.** [`packages/bb-app/scripts/build.mjs`](../../../../packages/bb-app/scripts/build.mjs) packages the app, server, bundled plugins and daemon, with no Rooms server or participation CLI artifact. The launcher does not own its separate process. Operator IDs, origins, fixed loopback upstream, initial-setup marker and LaunchAgent configuration also live outside the archived native state. A packaged install or normal move destination therefore lacks the component that serves the native Rooms session descriptor. The app correctly treats a descriptor 404 as ordinary BB, which means this failure can appear as Rooms disappearing.

4. **Medium: dispatch and publication are not part of BB's freeze.** The move coordinator freezes core writes, stops native turns, suspends plugins, then takes its snapshot. `RoomRuntime.tick()` and `/api/agent/commands` do not consult that fence. Simply including another SQLite file would permit a room publication, membership change or queued delivery after one snapshot and before the other. Independent `backup()` calls are individually safe SQLite snapshots, not a consistent application checkpoint.

5. **Medium: graceful shutdown is incomplete.** `RoomRuntime.close()` only clears its timer; existing async runs and direct `tick()` calls are not fenced or drained. `server.ts` waits for `server.close()` before exiting, while the Rooms SSE route continues until the browser aborts. An open room stream can hold shutdown open; an in-flight runtime operation has no defined checkpoint before database close/process exit. This is a source-supported failure path; no SIGTERM probe was run during this read-only review.

## Native integration path

### Smallest safe interim behavior

Register the presence and lifecycle capability of native Rooms with core. Core must refuse combined move and combined export before a destructive or misleading operation can begin, with the same result through UI, SDK and CLI. If BB-only export remains offered, make its scope explicit at the operation boundary and offer a verified combined backup alternative. Keep the existing edge refusal as defense in depth, not the policy owner. A documentation warning alone does not turn the existing archive into a complete backup.

This guard is small. Enabling complete move is not: the following pieces must be delivered and tested together.

### First native vertical slice: shared persistence and owned startup

1. Extract a server-side Rooms module with a `DbConnection` dependency. Let `RoomsStore` use the server-owned connection; retain a path-based standalone adapter only for legacy migration/fixtures. The store must not close a connection it does not own.
2. Perform a one-time, offline, transactional import of only the `rooms_*` rows from the legacy database. Preserve IDs, password hashes, membership, session expiry, sequence numbers, receipts, bindings and pending states. Reject conflicting nonempty destination data; do not import the second database's unrelated BB tables. Verify counts, relationships and sequence continuity, record a migration marker, then retain the source backup. Never operate both copies as writable authorities.
3. Store operator grants and initialization state in server-owned settings/tables, with validated configuration APIs and CLI parity. Do not derive operator rights from room ownership. A restored database must not generate another Workshop solely because the old external `initialized` file was absent.
4. Mount Rooms routes and its session descriptor within BB's server bootstrap, preserving the separate guest, operator, machine and activation-capability lanes. Guests must never inherit loopback trust or unrestricted `/api/v1` access. Existing operator controls and the SDK continue through the same core operations. The current external edge can remain temporarily for transition; it must not be the sole owner of durable state.
5. Start, stop and recover the dispatcher from BB's lifecycle. Package the explicit participation CLI with the actual server build, add Turbo dependencies, and exercise the installed tarball. Remove dependence on a separate source checkout or untracked launcher to make the feature exist.

With the room tables and durable settings in `bb.db`, normal SQLite backup includes them atomically with BB thread/admission state. This removes the need for a second archive format just to preserve room records. It does not by itself authorize resuming imported work.

### Freeze, restore and move

The core coordinator's existing sequence is the integration point: `runStopWork` sets the write freeze, pauses schedules, stops turns and suspends plugins; `runExport` sets the snapshot fence; destination import applies fixups and starts pending; only confirmed activation commits the switch. Cancellation resumes deferred work. Extend these phases with Rooms participant lifecycle operations:

- Fence new public mutations and new dispatch before snapshotting. Finish or explicitly interrupt open publications, reconcile admitted work, and retain uncertain dispatch without replay. Do not wait indefinitely for an agent to decide to finish.
- Persist enough recovery state to distinguish queued work, confirmed native completion, lost acknowledgments and deliberately interrupted streams. On restart/import, start reconciliation before new dispatch. A pending destination must not dispatch until activation commits; cancellation must restore source service once.
- Revoke or regenerate activation capabilities at the correct transition and clean their recorded host files through BB. `credentialHostId` and `credentialPath` refer to execution-host storage and must not be rerooted as server-owned paths.
- Preserve BB project/thread/environment IDs. Existing execution hosts and workspaces remain where BB already manages them; a server move is not a provider-credential or workspace migration. The room command endpoint must remain reachable from those hosts. The current loopback-only agent origin cannot survive a server relocation to a different machine without reconfiguration; use a stable reachable origin or an explicit host-routed command transport.
- Verify room schema, operator identity, membership and dispatcher readiness in destination health before ingress switches. Update generated machine/public URLs through BB's existing server-access configuration, not a stale `ROOMS_BB_URL` in another service.
- Extend cancellation, interrupted import, uncertain activation and old-copy cleanup to the same owned state. Never allow a restored clone and original to dispatch the same saved deliveries concurrently.

Adding `rooms/` to archive roots would also require import allowlist, SQLite classification, sidecar handling and rollback changes. The current inventory marks files recursively discovered under ordinary trees as non-SQLite, so copying a live `rooms.sqlite` tree is specifically unsafe. A sanctioned second database could be supported, but requires coordinated snapshot/freeze hooks and durable manifest compatibility; shared `bb.db` avoids this additional consistency boundary.

## Verification required before claiming complete integration

| Capability | Required proof |
| --- | --- |
| Legacy import | Original two-user/two-agent history, credentials, receipts, IDs and associations preserved; a second import neither duplicates nor overwrites. |
| Export and restore | Use the real BB export/CLI import into a fresh isolated installation; authenticate both users, open actual agent threads, and complete new explicit Codex/Claude publications. |
| Snapshot consistency | Export while publication/dispatch is in flight; restored admission, delivery and stream states agree without duplicate publication or execution. |
| Installed package | Boot the packed artifact with no source checkout or custom Rooms LaunchAgent; Rooms, CLI publication, local helper and machine enrollment work. |
| Move | Use two isolated execution machines and the real move UI/SDK; preserve identity/history, reachable command endpoints and attached threads after ingress switch. |
| Failure recovery | Exercise cancellation before activation, lost activation acknowledgment, source restart, destination restart, and import rollback. Exactly one dispatcher becomes authoritative. |
| Graceful shutdown | Leave two browsers on SSE plus an active native turn, request shutdown, and prove bounded exit/restart with explicit stream/work recovery. |

## Security and regression review

The inspected edge keeps room ownership separate from operator access, authenticates native HTTP and browser sockets, rechecks socket/session revocation, strips supplied trusted proxy headers, and requires BB's existing enrollment/daemon validation on a narrow machine lane. Loopback-trusted enrollment-key and pending-move routes stay excluded. I did not identify an additional confirmed authentication bypass in these paths. This conclusion does not certify unreviewed plugin-defined transports or hostile same-OS execution accounts.

The significant confirmed regressions against “all BB functionality” are the incomplete lifecycle operations above. Native resource/room browser evidence already establishes representative UI compatibility; it does not establish export, import, packaged installation or migration. No lifecycle tests were executed for this review, and no runtime mutation was made.
