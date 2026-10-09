# Native providers and durable steering

Authentication, model discovery, explicit publication and execution recovery are separate checks. After Chris approved credential transfer, Codex and Claude authenticated inside the disposable VM and BB enumerated their models. Actual agents then independently authored room conversation and public stream chunks through the CLI. The exact selected models were `codex/gpt-6.1-sol` and `claude-code/claude-opus-5-5`; availability was observed through the candidate's provider API, not inferred from a model name.

The earlier Pi-only steering restriction was a Rooms qualification guard. Both native bridges advertise input injection and implement `turn/steer`: [Codex](../../../plugins/provider-codex/src/bridge/bridge.ts), [Claude](../../../plugins/provider-claude-code/src/bridge/bridge.ts). Actual native runs verified accepted human steering and subsequent agent-authored output showing its effect. The [runtime evidence](../spikes/explicit-participation/runtime-v2/README.md) records each result and its build scope. A provider declaration alone is not that evidence.

## Permissions must preserve the provider contract

The generic Rooms approval button submitted a null permission profile for every request. That works for an ordinary command approval, but Codex rejects it for a granular permission grant. The provider's [response encoder](../../../plugins/provider-codex/src/interactive-requests.ts) requires the requested profile. The corrected UI parses the shared interaction contract, offers only advertised decisions, and submits the corresponding permission or session grant. The owner still chooses; the adapter does not silently approve it. A browser regression reproduced the old null payload before the correction.

## A steering acknowledgment is not completion

Each steering send is another external submission into the existing private session. The original turn's terminal event cannot prove that a delayed steering request will never arrive. An in-memory promise or busy flag also disappears when the gateway restarts.

The repair persists each steering submission's identity, activation, thread and exact bounded text before sending. Normal completion and owner recovery retain the execution lease until every submission has its own terminal admission proof or a confirmed queue cancellation. Multiple steering submissions can coexist. A lost acknowledgment fences publication and preserves uncertainty; the gateway never automatically replays that input. While the current process still owns an in-flight send, it holds the lease without prematurely treating ordinary transport latency as orphaned execution.

Queue cancellation and the corresponding steering settlement commit atomically. Stop revokes publication before requesting native cancellation, and late failures cannot resurrect a completed activation. Owner recovery preserves separate room follow-ups that have never been dispatched; explicit Stop intentionally cancels them. A fault test exposed the earlier recovery path accidentally using Stop's broader scope, and the store regression reproduced that loss before the correction. [Focused storage and proof tests](../../validation/rooms-v2/steering-durability/store-proof.md) establish these database and event-correlation boundaries. Actual-BB/Codex transport fault injection subsequently passed lost acknowledgments before and after admission, gateway SIGKILL before admission, and delayed successful acknowledgment. The preserved red/green native-interruption case also proves a separate queued human request survives and executes after the interrupted activation settles. See the [runtime evidence](../spikes/explicit-participation/runtime-v2/README.md) for exact executed counts and historical failures.

## Live updates must preserve a human draft

The mixed-provider browser test also caught an unrelated collaboration defect: the controls form was keyed by the server activation budget. A delayed snapshot from the previous save remounted the form while a human edited the next value, restoring the old budget. Waiting longer in the test did not repair that data loss. The budget is now controlled draft state initialized when controls open, independent of incoming snapshots. A focused pre-fix failure and passing Chromium/WebKit regressions prove the blank draft survives a changed snapshot and submits an unlimited budget. The earlier timing-only diagnosis and both failed public runs are preserved in the [UI evidence](../../validation/rooms-v2/ui/README.md).

## Keep fixture failures distinct

Claude rejected the cancellation fixture's foreground sleep and used background execution instead. A test that only recognizes a pending foreground sleep therefore cannot establish whether Stop works. The replacement fixture stops an actually active authored stream and checks native termination, retained interrupted public text and rejection of obsolete publication credentials. Changing the observation to a supported real operation preserves the cancellation requirement; prewritten stream chunks would not establish natural composition.

Final qualification status belongs in the [verification report](../../validation/rooms-v2/README.md). Positive provider runs, browser rendering checks and transport fault tests address different failure modes and must remain distinguishable there.
