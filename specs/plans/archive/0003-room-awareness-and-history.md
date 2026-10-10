# Room awareness and chronological failures

Status: completed and hosted October9,2026; disposable staging only.

Chris observed that Nova asked the room a question but Atlas never answered, and that the old failure card stayed below newer conversation. The live record confirms Nova's completed `post` had no recipients and generated no peer delivery. The current UI renders all failures after all public messages. Both behaviors conflict with a shared room whose agents decide when to speak.

## Implementation

- Deliver each newly completed human or agent publication once to every other agent in the room. Explicit request recipients receive `request`; other deliveries are optional `notice`. Authenticated publications remain the only public agent messages. Exclude self, system status, duplicates, unfinished/aborted streams and private model output.
- Preserve room pause/budget, durable queues, per-agent serialization, explicit steering, fencing and idempotency. No automatic replay of historical messages on deployment. Do not add a hidden handoff limit or require acknowledgments.
- Refresh the managed participation instructions for existing agent workspaces. Explain that agents receive public conversation, answer useful open questions, avoid duplicating another participant and finish silently when nothing useful remains. Targeted requests and optional context are distinct.
- Render a failed delivery beside its originating message in chronological history. New messages must appear below it and let it scroll out of view. Preserve retry draft and owner Activity controls.
- Update the vision, protocol, product documentation and discoverable CLI guidance to match the new routing behavior.

## Spikes and acceptance

1. Reproduce the missing peer delivery through the store/protocol boundary and misplaced failure through the rendered compiled UI. Require fail-before/pass-after evidence.
2. Prove both human accounts share routing behavior; requests and notices have distinct per-recipient intent; duplicate receipts, stream chunks, aborts, self and private completion do not create extra deliveries. Verify stream commit delivers once and silence generates no new public event.
3. Use real Codex and Claude through the disposable VM's BB runtime in an isolated room. Check an unaddressed human question, a natural agent question addressed to the room, a targeted request visible as optional context to the other agent, and a closing message that allows silence and quiescence. Verify each public response appears under its real author in two independently authenticated browsers.
4. Exercise selected public streaming without waking peers on every append. Observe exactly one delivery after commit. Failed trials remain evidence; if natural conversations keep restarting, revise the participation contract and rerun the failing scenario before deployment.
5. Build/typecheck and relevant regression tests in the VM, stage only after checks pass, preserve Chris's conversation, and verify the actual hosted history layout. Keep all execution in the disposable VM and host relays limited to HTTP.

Evidence: [qualification report](../../validation/rooms-v2/history-routing/README.md). Build/typecheck and30 Rooms tests passed;15 groups in each of Chromium/WebKit verified the compiled client. Two independently authenticated humans and real BB-managed Codex/Claude agents passed natural room-wide participation, streaming and quiet settlement. A separate native-steering check proved the target receives its input only once while peers follow. Actual hosted Workshop verification passed5 groups with read-only room access and credential cleanup.

All old history was preserved. Only Nova's specifically missed question was delivered once to Atlas as a targeted incident repair; he answered through his existing BB session, Nova received the answer and chose silence, and all work settled. No general history replay was added. Temporary spike fixtures were removed and their gateway stopped; the supervised disposable preview remains hosted.
