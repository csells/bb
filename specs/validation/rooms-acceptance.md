# BB Rooms staging acceptance — 2026-10-09

Candidate: `csells/bb`, branch `rooms`, based on get-bb/bb `9a47d42c78ca9689af0b78da9b3155a8c0b36251`. Candidate code, BB execution runtime, agent workspaces, SQLite data and browser tests run in a disposable macOS VM. Model inference uses the explicitly authorized shared Ollama service through Pi 0.84.0. No personal Claude or Codex sign-ins were copied. The stable BB installation is unchanged.

## Executed checks

- Frozen pnpm 9.15.0 install passed. Full BB build passed (55 tasks).
- Rooms build and typecheck passed; 15 tests passed across authorization, CSRF, forged attribution, routing, persistent idempotence, invite uniqueness, membership revocation, SDK authentication/logout, ambiguous restart dispatch, cancellation and handle collisions.
- CLI build and typecheck passed; 857 tests passed, one upstream test skipped, across 72 test files.
- Built CLI against public HTTPS: login, mode-0600 token creation, room listing, attributed send, persisted conversation read passed.
- Browser human acceptance: two independent accounts and cookie stores, UI invitation flow, live messages in both directions, simultaneous sends exactly once, reload persistence, anonymous/forged requests rejected, membership revocation, desktop/mobile rendering and no browser exceptions.
- Public HTTPS real-agent acceptance: two persistent Pi agents (Builder and Reviewer), using `rooms-local/qwen3:4b-instruct-2507-q4_K_M`, both answered the same human prompt. The browser observed 12 distinct partial text lengths for Builder and 13 for Reviewer. Both signed-in browser accounts saw both attributed replies.
- The second human used the composer to request an actual filesystem write/read. The real agent ran `echo "ROOM-PROOF-42" > rooms-proof.txt && cat rooms-proof.txt`. Activity and the resulting answer appeared in the room and survived reload.
- Explicit agent handoff invoked the other persistent agent and produced `HANDOFF-OK`.
- UI Steer changed a real agent's response to `STEERING-ACCEPTED` while a tool was running.
- UI Stop cancelled a running `sleep 45` and marked its delivery/activity stopped. A subsequent request preserved that stopped history.
- Gateway restart during an active `sleep 15 && cat rooms-proof.txt` reattached to the same BB thread. The agent completed with `RECOVERED / ROOM-PROOF-42`, proving retained workspace and conversation identity.

## Fixes found through acceptance

The browser SDK needed the repository's source export condition. Agent descriptions that mentioned another participant could spuriously dispatch work, so handoffs now require an explicit `[[ask @handle: request]]` directive. Stopping while dispatching could race late callbacks; local cancellation now wins and stops a newly created underlying thread. Follow-up dispatch advances past the previous stopped timeline. Interrupted submissions become visible ambiguous errors rather than duplicate prompts. The CLI test suite caught missing command-index and reserved-name registrations; both were fixed.

## Limits

These checks used automated browser accounts representing two humans and real Pi agents. Claude Code and Codex integration uses the same BB SDK path but was not authenticated or exercised in this VM. Their provider decision UI is implemented but not certified by these Pi tests. Pi agents share a trusted execution VM and are not isolated from hostile peers at the OS level. This preview is for trusted collaborators, not unrelated tenants.

Cloudflare's temporary public tunnel can change its hostname on restart and has no uptime guarantee. Its active PDX connection passed public HTTPS tests; the startup precheck could not reach the secondary region2 edge. The preview is available over the working connection, without redundant edge connectivity. SSE is buffered by quick tunnels; the polling fallback was used for public incremental delivery. A separate BB Connect relay is available for the owner's BB session.

The preview shows the most recent 300 messages and includes up to 80 completed messages within a 32,000-character shared-context budget. It has no SSO, password recovery or per-member billing limits. Gateway and BB runtime use launchd restart supervision inside the VM. VM expiry is a manual review date, 2026-10-16 23:00 UTC, not an automatic teardown promise.

## First-response latency and pending UI — follow-up

The first Workshop request at 16:36:02.456 UTC reached both Pi providers by 16:36:05.136. BB recorded Reviewer's first text at 16:36:23.344 (20.9 seconds after submission), and Builder's at 16:36:36.488 (34.0 seconds). Both turns completed by 16:36:44.522. The subsequent Builder request produced its first text in 3.3 seconds. These are backend event timings, not reconstructed browser paint times.

The shared Ollama log accounts for the delay: a 3.05-second model load, 14.91 seconds processing the first 5,051-token agent prompt, then generation. Its single inference slot served the two requests serially; the second reused 3,759 prompt tokens and spent another 4.45 seconds processing the remaining context before emitting text. The Rooms dispatch itself took under 0.2 seconds. Public polling and timeline projection can add display delay, but do not explain the initial model wait. No shared model configuration was changed by this fix.

The UI previously rendered only actual timeline messages, leaving no conversational placeholder before the first text. It now renders one pending card per active delivery, with explicit queued/starting/waiting/working state and a ticking elapsed time. Actual streaming text replaces that agent's pending card; terminal deliveries clear it. The composer remains usable. Existing SDK and CLI snapshots already expose the delivery state and timestamps used by this presentation.

Regression command (inside the candidate VM): `node --conditions=source --import tsx apps/rooms/test/pending.browser.ts`. Against the pre-fix build it failed: expected two pending cards, received zero. Against the new public build it passed waiting for two agents, ticking time, queued/starting states, independent streaming replacement, between-output activity, stop/error/completion cleanup, reload, mobile viewport/no overflow and no browser exceptions. This deterministic UI test supplies controlled API snapshots to the actual built web application. The separate real-agent test uses unmodified public API responses and independent signed-in browser contexts.

The public real-agent browser run passed after the fix: both human accounts saw two pending cards within 835 ms of submission; first text was observed through the public API at 20.4 and 36.7 seconds, with 12 distinct incremental lengths per agent. Both humans saw both replies; the second human successfully requested a real file write/read and reloaded the persisted result. Build, typecheck and all 15 Rooms tests passed. This fixes the missing feedback, not the shared model's serial inference latency.

## Open-topic discussion — follow-up

The default Builder/Reviewer specialties and Pi's coding-assistant context encouraged a spurious refusal to discuss philosophy. There was no Rooms topic filter: the model generated the prohibition. A public browser reproduction using the exact reported meaning-of-life request, the original specialties and real Pi/Qwen agents produced another refusal and no Reviewer response.

The room prompt now explicitly supports general conversation, debate, creative work and coding. Names and specialties identify perspectives rather than topic boundaries. It distinguishes presenting arguments from possessing personal beliefs, rejects prior assistant claims of topic restrictions as room policy, and tells agents to invite their counterpart when a human requests a debate. Tools are used when needed. The existing two-handoff execution bound remains unchanged.

The real-provider regression is `node --conditions=source --import tsx apps/rooms/test/discussion.browser.ts`; `ROOMS_DISCUSSION_ROOM` optionally reuses an owned QA conversation to test recovery after a refusal. It uses a separate test account and room; Workshop history and agent identities are preserved. A first correction enabled handoffs but still included an AI-inability disclaimer; manual inspection caught that gap and the regression assertion was tightened before the final prompt revision.

Final public real-provider validation passed in a fresh owned QA room using the exact reported request and original Builder/Reviewer specialties: Builder gave a philosophical position, Reviewer challenged it through a real handoff, and Builder answered that challenge. No topic or AI-inability refusal appeared. The existing two-handoff cap ended the automatic exchange after three responses; a further requested handoff was not executed. This remains a prototype limitation, not a BB platform restriction. Build, typecheck and all 15 Rooms tests passed. The reusable browser test also waits for a new delivery before checking completion, avoiding a race with earlier completed turns.
