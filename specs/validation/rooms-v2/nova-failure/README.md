# First task-board prompt regression

This focused public browser check replays the exact reported input in a new disposable QA room:

> @atlas @nova Propose a plan for a shared task board. Each share your own perspective.

It uses separate human accounts in two fresh Chromium contexts. Atlas uses Codex `gpt-6.1-sol`; Nova uses Claude Code `claude-opus-5-5`. Both providers execute through the existing Rooms → BB runtime. The harness selects structured recipients and requires two independently attributed substantive public responses, visible with identical message identities and content to both humans, and completed deliveries without errors.

This checks the reported first-turn failure on the live compiled artifact. Earlier longer conversations passed but did not establish reliability for this exact first task input and newly discovered startup failure. It adds no production-only testing seams and does not touch Chris's Workshop. Browser contexts close and log out on exit. Model threads and the exact QA room require separately scoped cleanup after evidence capture.

Status: passed against the repaired public candidate on October 9, 2026, 22:05:33–22:05:48 UTC. The existing user failure supplied pre-repair evidence; this exact harness ran only after repair, so it is post-repair qualification rather than a separately demonstrated red/green harness.

Nova published 1,176 characters and Atlas published 1,036 characters as separate authors. Both independently authenticated human browsers observed each public message with identical IDs and rendered content. Both deliveries completed with outcome `replied` and no errors. No provider approval was required and no browser page errors occurred. The captured screenshot can retain the preceding Nova-working frame until the next SSE update; the final authoritative snapshot records both completed deliveries.

Evidence: [result](task-board-pass/result.json), [public snapshot](task-board-pass/snapshot.json), [delivery transitions](task-board-pass/observations.json), [owner screenshot](task-board-pass/owner.png), [member screenshot](task-board-pass/member.png), and [test log](task-board-pass/test.log).

[Guarded cleanup](task-board-pass/cleanup.json) archived the two idle QA BB threads and removed only this one fixture room, its two exclusive QA users, and its workspaces. Workshop room data, membership and messages were compared inside the cleanup transaction and remained unchanged. Both browser sessions logged out and the browser closed. Five exported JSON files contained zero matches for the scanned credential markers; no authentication values were exported.

Run inside the candidate VM, from the Rooms app directory with the existing `tsx` dependency:

```sh
ROOMS_TEST_REPO=/Users/admin/code/Forks/get-bb/bb \
ROOMS_TEST_DATA=/Users/admin/rooms-v2-data \
ROOMS_TEST_ORIGIN=https://diary-butler-leone-heavy.trycloudflare.com \
ROOMS_TEST_EVIDENCE=/Users/admin/nova-failure-task-board \
pnpm exec tsx /Users/admin/code/Forks/get-bb/bb/specs/validation/rooms-v2/nova-failure/task-board.browser.mjs
```

The output records fixture identifiers, transition observations, public snapshots and final screenshots. It does not export passwords, invitation tokens, session cookies or private provider transcripts. A native approval stops the harness for scoped review rather than granting unknown commands.
