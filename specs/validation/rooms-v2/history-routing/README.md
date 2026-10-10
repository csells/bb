# Room-wide delivery and optional participation

Status: natural provider spike passed October 9, 2026, 22:46:02–22:47:18 UTC (76 seconds), against the final compiled candidate at separate VM gateway `http://127.0.0.1:38906` and data `/Users/admin/rooms-awareness-spike-data`. The user-facing preview was not changed by this spike.

All four stages passed with real BB-managed Codex and Claude agents: 11 public messages including 7 agent contributions, 15 completed deliveries including 8 without public replies. Both human observers recorded three growing text states for the same public stream. Optional notices produced useful replies where requested by conversational context and silence after the closing message; the room became quiescent without an execution-count cap. This is one observed conversation, not a guarantee against every possible future loop.

Evidence: [result](run1/result.json), [initial open question](run1/unaddressed-open-question.json), [peer question and answer](run1/peer-open-question.json), [stream completion](run1/stream-commit.json), [both stream observers](run1/stream-observers.json), [closing silence](run1/closing-silence.json), [state transitions](run1/observations.json), [owner screenshot](run1/owner.png), and [test log](run1/test.log).

[Cleanup](run1/cleanup.json) archived the two idle QA BB threads, removed only this fixture room, its two exclusive QA accounts and its workspaces, and verified the separate staging Workshop unchanged. Browsers logged out and closed. Exported JSON files had zero matches for the scanned credential markers. Hosted qualification is recorded below; the natural spike ran in its own gateway and data directory.

The new delivery contract is that each completed public human or agent message creates one delivery for every other room agent. Explicitly requested recipients receive a request; other agents receive an optional notice. A delivery is an opportunity to participate, not a public reply. Provider assistant text remains private, and an agent publishes only through its authenticated room CLI. Streaming chunks do not create deliveries; commit does.

## Natural qualification

`room-wide.browser.mjs` creates a new QA room with two independently authenticated human browser sessions and separate BB-managed Codex `gpt-6.1-sol` and Claude Code `claude-opus-5-5` agents. Standard Workshop agent instructions are retained. Prompts use ordinary conversation and ask for visible incremental composition without supplying command scripts or predetermined public text.

1. An unaddressed human question reaches both agents as optional notices. The spike seeks useful, independently authored contributions from both, visible in both browsers.
2. A targeted human request asks Atlas to pose an open question to the whole room. Atlas is requested; Nova receives the same human message as an optional notice. Atlas's subsequent recipient-free question must deliver once to Nova, produce her own answer, and never self-deliver to Atlas.
3. An ordinary request for a gradually composed proposal produces one growing public message in both browsers. Repeated snapshots must show no peer delivery while incomplete; completion must create exactly one peer notice.
4. An unaddressed closing message reaches both agents as optional notices. Both must settle without public replies, with no continuing activation backlog.

The test inspects public API delivery records, causal message IDs, both rendered observers, and quiet settlement over multiple polls. It does not infer a private model's intention from a `no_reply` outcome. No hidden handoff cap or automatic private-transcript publication is introduced. A timeout is a failed qualification, not evidence of safe quiescence.

## Risks and interpretation

- Optional notices can cause repeated agreement or goodbye loops; natural quiescence needs actual observation. A single passing conversation cannot prove loops are impossible.
- Concurrent agents can react before seeing each other's answer. Per-agent serialized turns and a shared public history preserve identity and order but do not by themselves ensure socially useful turn-taking.
- A busy agent can accumulate notices faster than it consumes them. This test checks bounded conversations; it does not qualify sustained-load fairness or backlog compaction.
- Wrong instructions can turn every notice into a mandatory reply. Actual prompts must describe optional participation consistently across startup and each activation.
- A model can use a targeted request even when asked to pose a room-wide question. Such a failure is distinguished from broker routing failure using the actual publication's recipients and resulting delivery.
- No-public-reply can mean deliberate silence or failure to use the CLI. Closing-stage behavior plus public absence is observable; private intent is not assumed.

The earlier routing suite deliberately required no delivery for ordinary posts, so its assertions must change at the routing owner. This natural spike covers model-driven participation under the new semantics, which deterministic store tests cannot establish. It adds no production testing seam.

## Execution and cleanup

Run only after the coordinated candidate build/deploy signal, inside the disposable VM:

```sh
ROOMS_TEST_REPO=/Users/admin/code/Forks/get-bb/bb \
ROOMS_TEST_DATA=/Users/admin/rooms-awareness-spike-data \
ROOMS_TEST_ORIGIN=http://127.0.0.1:38906 \
ROOMS_TEST_EVIDENCE=/Users/admin/rooms-history-routing-run1 \
pnpm exec tsx /Users/admin/code/Forks/get-bb/bb/specs/validation/rooms-v2/history-routing/room-wide.browser.mjs
```

The matching `cleanup.mjs` requires a successful result and exact QA fixture identity, refuses active work, archives only fixture threads, removes only its room and exclusive QA accounts, and compares Workshop data before/after its transaction. On failure, stop/review only recorded QA resources before cleanup; never mutate Chris's Workshop. Export evidence before cleanup. Native approval is a separate owner decision and must be inspected rather than automatically approving unknown commands.

## Final candidate and hosted repair

The final combined Turbo build, typecheck and all **30 Rooms tests** passed in the disposable VM; see [build log](build-typecheck-test.log). The **15 Chromium and15 WebKit groups** passed against the same client asset hashes used by that build; see [UI proof](ui/README.md). The separate [native steering proof](steering/README.md) passed against the final server artifact: input accepted by BB was not queued a second time to its target, while its peer received one optional notice. These are complementary runs, not a claim that every historical suite was rerun uninterrupted.

The public gateway was restarted only after verification and with all original activations settled. Existing managed agent instructions refresh on their next activation, so the correction applies to persistent Workshop sessions too. The targeted [repair script](repair-missed-question.mjs) delivered only Nova's previously missed completed question to Atlas as optional context, asserting the exact room/author/message, no existing delivery and no ongoing work. There is no automatic replay of old history on deployment, no new message attributed to Chris, and no fabricated agent answer.

Atlas answered through his existing BB-managed session and authenticated CLI; his public answer had Nova's question as its cause. Nova received that answer once and finished with `no_reply`; all work settled. [Live repair evidence](public-repair.json) includes the causal records and verifies that a SHA256 of all earlier messages stayed identical.

The [source manifest](source-sha256.json) identifies changed Rooms source/tests matched byte-for-byte to the VM. These are local worktree changes on the recorded fork base, not a newly pushed commit. The temporary acceptance gateway38906 was stopped after both fixture cleanups; the supervised public gateway remains available. Stable BB/Buzz execution and configuration were unchanged.

The actual hosted Workshop also passed [five browser assertion groups](ui/live-workshop/checks.json): the failed attempt is beside its original request, later responses are below it, and it is outside the viewport when viewing the latest conversation. The browser sent no room writes, logged out, closed, and removed the temporary credential fixture. See [latest conversation](ui/live-workshop/workshop-latest.png) and [UI report](ui/README.md).
