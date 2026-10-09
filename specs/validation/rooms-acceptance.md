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
