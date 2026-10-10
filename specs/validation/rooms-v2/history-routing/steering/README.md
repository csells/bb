# Native steering under room-wide delivery

Status: passed October 9, 2026, against the final compiled repair at isolated gateway `http://127.0.0.1:38906`. The real Atlas `sleep 20` tool was observed pending at 22:54:44.204 UTC; the second human received a native `sent` receipt at 22:54:44.245 UTC.

All required observations passed, including exactly one Atlas activation, no duplicate target delivery, one Nova optional notice without a public reply, and the steering marker in Atlas’s independently published answer seen by both humans. No browser errors occurred. This is controlled lifecycle proof, not the natural-composition result.

Evidence: [result](run1/result.json), [actual pending native tool](run1/pending-work.json), [steering receipt](run1/steering-receipt.json), [final public snapshot](run1/snapshot.json), [owner screenshot](run1/owner.png), and [test log](run1/test.log). [Cleanup](run1/cleanup.json) archived the two idle QA BB threads and removed only this exact fixture room, its two exclusive users and workspaces; the separate Workshop was unchanged. The public gateway was untouched.

Room-wide delivery changes the meaning of publishing an accepted human steering input. The target already receives the input through BB native steering. Publishing that text must preserve the target's structured identity and notify other agents, while avoiding a second queued delivery to the target.

This is a controlled lifecycle check, separate from the natural room conversation spike. Two fresh human browser sessions and BB-managed Codex/Claude agents run in the isolated awareness gateway. Atlas executes a real `sleep 20` tool; the harness observes that pending tool and active BB thread before the second human sends input through the actual Rooms steering endpoint. The human input asks Atlas to include a unique marker in its own CLI-published answer; Nova is explicitly asked to observe silently for this control check.

Required observations:

- Native steering returns `accepted: true, delivery: sent` while Atlas is working.
- Both human browsers see the accepted human input and Atlas's marker-bearing public answer.
- The public steering message identifies Atlas as recipient, creates no new Atlas delivery, and creates exactly one optional notice for Nova.
- Atlas has exactly one activation, and its observed answer belongs to the original activation's triggering message. The input therefore did not succeed merely by starting a later activation.
- Nova finishes its notice without public output, and all deliveries settle successfully.

The broad earlier native steering proof ran before ordinary posts notified all peers; it could not expose the duplicate target activation introduced by that routing change. This focused test uses the real BB/provider boundary and adds no production-only seam. It is post-repair qualification unless explicitly run before the fix; deterministic route/store tests own the regression's red/green proof.

The matching cleanup script is restricted to the recorded uniquely named fixture, refuses active native work, archives only its agent threads, and preserves the awareness gateway's separate Workshop. Credentials and private provider transcripts are not exported; pending-tool evidence includes only command/status/IDs needed to prove the native execution was active.
