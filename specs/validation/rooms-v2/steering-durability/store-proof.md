# Durable steering storage and admission proof

2026-10-09. This records the focused storage/proof validation. The runtime transport regression and real-provider runs have their own evidence; these tests do not substitute for them.

## Failure mechanism

The old runtime tracked an in-flight steering send only in memory. A lost SDK acknowledgment or gateway restart could erase that knowledge. Completion of the original agent input then provided insufficient evidence for releasing the activation: the separate steering request could still arrive later.

The repair persists each steering submission before calling the provider gateway. Its immutable identity binds the activation, execution thread, and bounded submitted text. Multiple steering submissions may remain pending within the same turn. A native send acknowledgment does not itself settle a submission.

The store refuses both normal activation completion and uncertain-execution recovery while steering remains pending. Publication revocation and Stop preserve this execution lease. Exact native request text, including the activation and unique steering markers, must have matching admission and terminal evidence. The original request's completion cannot substitute for this proof. No uncertain input is replayed automatically.

A confirmed native queue deletion records its cancellation receipt and the matching steering settlement in one SQLite transaction. A crash between separate local writes therefore cannot leave an acknowledged cancellation detached from its steering submission. A delayed transport failure cannot resurrect an already stopped or settled activation.

## Executed verification

All commands ran in the disposable Rooms VM source checkout. The running Rooms distribution and BB core were not rebuilt or restarted by this verification.

```sh
pnpm exec turbo run db:generate --filter=@bb/db
pnpm exec oxfmt packages/db/src/schema.ts apps/rooms/src/store.ts apps/rooms/src/admission.ts apps/rooms/test/admission.test.ts apps/rooms/test/protocol.test.ts
pnpm exec turbo run test --filter=@bb/rooms -- test/protocol.test.ts test/admission.test.ts
```

Generated migration0144 adds normalized `rooms_steering` records and a targeted activation/state index. The generated migration and snapshot were retained unchanged after generation.

The final focused run passed **12 tests in two files**: eight real-SQLite protocol tests and four typed native-event admission tests. The new storage regression closes and reopens a file database, confirms both pending submissions and their original text survive, rejects cross-thread/activation settlement and changed payload reuse, preserves the lease through Stop, verifies cancellation rollback is atomic, and permits the next delivery only after both submissions settle. The new admission regression rejects completion of the original input, wrong steering identity, and changed text before accepting the exact steering request's own terminal proof.

These tests protect distinct boundaries: durable database ownership and native-event correlation. The runtime owner separately preserves and exercises the pre-fix transport behavior against an archived executable, followed by the repaired gateway. That evidence determines the end-to-end regression result.

- [Focused test output](store-tests.log)
- [Generated migration output](migration.log)

## Recovery preserves queued human follow-ups

The actual transport regression exposed a separate issue: owner recovery reused the full Stop fence, which cancelled human requests that had never been dispatched. The storage regression was extended before changing the store. Against the old store it failed with a queued follow-up unexpectedly in `stopped` state. The repair adds an explicit `active-execution` fencing scope for recovery; ordinary Stop retains `all-deliveries` behavior. Unresolved uncertain execution also keeps its visible `uncertain` status.

The VM then ran all eight protocol tests successfully, including the retained assertion that Stop cancels queued deliveries. No migration or running distribution changed during this focused red/green check. The runtime owner's transport test separately verifies that a preserved follow-up subsequently executes exactly once after recovery.

- [Pre-fix real-database failure](recovery-queue-red.log)
- [Post-fix protocol test output](recovery-queue-green.log)
