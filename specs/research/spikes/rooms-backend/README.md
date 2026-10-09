# Durable participation backend verification

Candidate source: the `bb-rooms` worktree, executed only in the disposable staging VM at `/Users/admin/code/Forks/get-bb/bb` on 2026-10-09. These results cover the replacement backend, separately from the earlier Gas City reference fixtures and the scratch Python broker.

The runtime agent first ran the combined Rooms suite with 21 passing tests. After removing the obsolete regex-routing test and changing pause/addressing behavior, this agent ran:

```
PATH=/opt/homebrew/bin:$PATH pnpm exec turbo run db:generate --filter=@bb/db -- --name=rooms_remove_ignored_fields
PATH=/opt/homebrew/bin:$PATH pnpm exec turbo run test --filter=@bb/rooms -- protocol.test.ts
```

Migration generation produced `0143_rooms_remove_ignored_fields.sql` and the corresponding Drizzle snapshot. All six protocol tests passed using real migrated SQLite databases. See [test output](protocol-policy-test.log) and [migration output](migration-cleanup.log).

The six cases cover:

- Authenticated agent authorship, rejected forged author/room fields, invalid recipients and cross-room replies, exact-payload receipt replay and changed-payload conflict, and addressed ordinary posts producing no wake.
- Successful no-post settlement revoking publication authority without releasing the still-active provider lease; another human's addressed notice remains queued until that lease finishes.
- Explicit public streams: another activation cannot append, sequence gaps and conflicting retries reject, chunks do not wake peers, commit delivers once, and changed-recipient commit retries reject.
- File-backed restart: a running capability and publication receipt survive; ambiguous dispatch is fenced, never replayed, and prevents a new claim. Trusted runtime-confirmed recovery preserves the original error record and rejects stale capabilities.
- Two SQLite connections serialize same-agent claims while separate agents remain active. This is a database-boundary contention scenario; it is not a multiprocess stress benchmark or proof of every runtime race.
- Visible configurable activation budgets, conversations exceeding two exchanges, and pause preserving pending input while already-active agents can finish/publicly post. Resume permits queued dispatch.

The tests do not invoke an LLM, Slack, native BB execution, or browser UI. Real provider publication and human interaction are separate acceptance work owned by the integration and UI agents. Shared-UID workspaces do not establish hostile-agent credential isolation. BB spawn/send lacks a durable idempotent admission receipt, so ambiguous external execution is represented explicitly rather than advertised as exactly once.

Review identified a runtime project-creation race before the database claim: competing workers could create different projects and dispatch through one while persisting the other. This was sent to the runtime owner for repair; these store tests alone do not prove that repair. A late remote dispatch after a timed-out acknowledgment remains a separate recovery boundary to review against the actual BB admission semantics.

Admission-proof helper verification subsequently passed **3 tests** using actual BB event schemas:

```
PATH=/opt/homebrew/bin:$PATH pnpm exec turbo run test --filter=@bb/rooms -- admission.test.ts
```

See [admission output](admission-test.log) and [source audit](bb-admission-audit.md). These fixture tests establish event-correlation rules, not proof that each live provider emits the required events; live candidate acceptance must establish that separately.
