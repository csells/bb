# Candidate runtime acceptance

This directory records verification of the implemented gateway, separately from the earlier throwaway broker spike. `apps/rooms/test/runtime.acceptance.mjs` starts the compiled gateway with separate data and two human accounts in the disposable VM. Each participating agent runs in its own BB thread using the selected Pi, Codex or Claude provider. Natural mode is the default. `ROOMS_ACCEPTANCE_CONTROLLED=1` supplies fixture commands and text; it cannot establish autonomous collaboration or model-composed streaming.

The natural assertions cover independently authored conversation beyond two peer handoffs, optional silence, model-composed public stream appends, gateway restart without execution replay, human steering observed during a real tool call, and cancellation fencing delayed publication. Codex and Claude now pass natural conversation, silence, model-authored selected public streaming, native steering, restart and cancellation. Earlier failures and the separate transport fault tests are retained below.

## Failures and corrections

- Attempt 1 exposed a harness launch race: passing an unopened log stream to `spawn`. Awaiting `open` fixed it.
- Attempt 2 exposed missing migration assets in the compiled gateway. The build now copies the same Drizzle directory used by the main server.
- Attempt 3 exposed the native events API's maximum page size of 100. The SDK accepted the string `500`, but the server rejected it. The activation correctly stayed reserved rather than completing from idle alone. The runtime now uses pages of 100.
- Attempts 4 (Qwen 2.5 7B) and 5 (Qwen 3 4B) had no work rows even after recursively inspecting the private timeline. Their private prose or printed command did not publish anything.
- Attempt 6 **did execute Bash** with a naturally composed `request --to @reviewer`. Its zero public messages were caused by our compiled CLI entrypoint, not by failure to choose the tool. An initial inspection missed work rows nested inside a folded turn; that diagnosis was incorrect.
- Early controlled runs also contained nested Bash work rows, including quote-repair attempts. Their final CLI invocation exited successfully with no output because of the same entrypoint bug. They did not pass the runtime fixture assertions.

The decisive CLI reproduction: invoking the original bundle under `/Users/...` printed 1,464 bytes of help, while a copied bundle under `/var/tmp/...` printed zero bytes and exited 0. macOS resolves `/var` to `/private/var`, so comparing `import.meta.url` against `pathToFileURL(process.argv[1])` silently skipped the entrypoint. A dedicated executable entry module removes that comparison. `agent-cli.acceptance.mjs` exercises the actual copied bundle as a subprocess, including authenticated HTTP publication, selected multiline text and visible invalid-command failure.

## Proven recovery and tool availability

`rooms-status-recovery-run2.json` records five passed checks against a copy of a genuine accepted activation and the actual BB core: connectivity failure preserves the activation and exposes its error; repeated identical failures log once; a real terminal receipt clears the transient error and settles without a public reply; private provider text stays unpublished; and BB's event sequence does not change, proving no redispatch.

A task-local proxy captured actual request metadata for the same candidate through an isolated Pi provider alias. Qwen 3 4B received tools `read`, `bash`, `edit`, `write`, and `update_environment_directory`, with streaming enabled and no explicit `tool_choice`. Ollama advertised tool capability and a tool-aware template. The proxy recorded no prompt, headers or credentials. The alias and proxy were removed after the diagnostic. This rules out missing Bash advertisement in that captured invocation; it does not excuse the CLI defect.

## Post-fix actual participation

`rooms-natural-v2-run7.json` records independently authenticated humans, both actual agents publishing through their own CLI capabilities, both BB threads having no parent, a discussion extending beyond two peer handoffs and then becoming idle, and a second human notice completing without any additional public reply. Repeated questions in this run were separate authored CLI calls with distinct successful receipts, not transport replay. There is no automatic content deduplication or handoff cap. This run predates the later asynchronous-request/shared-goal wording clarification; later acceptance runs exercised the clarified prompt.

The same run failed the natural streaming gate: the model passed an incoming human message ID to `stream begin`, which correctly rejected that unsupported argument, then wrote the story privately. No public stream began and the private fallback remained private. The interface now explains that begin has no arguments, returns a new stream ID, and parse errors include valid CLI usage. The prompt also explains that requests return asynchronous delivery receipts, not blocking peer answers; later replies arrive in later activations.

`rooms-controlled-v2-run2.json` passed explicit independent fixture publication, top-level threads, silence, selected public stream revisions, and gateway restart with the same activation/thread and exactly one publication. It stopped at an erroneous harness assertion: steering was submitted as a fixture-file command, while the check looked for a marker located inside that file. Its retained snapshot shows the exact human command and the agent's `LIGHTHOUSE_TEAM` publication; the native receipt was `delivery: sent`. The assertion now compares the actual submitted human text and separately checks the agent-observed marker. `rooms-controlled-v2-run2-audit.json` independently derives actual private final text from recursive timeline rows and confirms none became a public message. Controlled fixture text and chunks are scripted and do not qualify autonomous composition.

`rooms-controlled-v2-run3.json` subsequently passed all 14 controlled checks, including actual native steering (`delivery: sent`) and agent-observed effect, stopping a real sleep tool, rejecting a delayed publication with HTTP 403, no post after cancellation, and comparison against actual private final strings. The fixture's public chunks and requested text are scripted; the real model invoked the fixture through its actual Bash tool, so this establishes runtime integration and lifecycle behavior rather than autonomous composition.

## Checkpoint before stronger-provider authorization

The corrected CLI entry, asynchronous request guidance and visible parse help passed a fresh Rooms build, typecheck and 24 tests. The actual copied-bundle subprocess acceptance passed four checks. The broader CLI suite previously passed 857 tests with one skip. Native steering includes the immutable activation marker, and pending receipt errors become visible after a bounded grace period without releasing or replaying uncertain work. The final shared-goal prompt wording passed another Rooms build/typecheck/24-test run and copied compiled CLI checks (`rooms-final-runtime-green.log`, `rooms-cli-final-v2.json`). By that checkpoint, controlled lifecycle verification had passed. The final fresh-agent Pi streaming attempt using `rooms-local/qwen3:4b` failed the unchanged observable-stream assertion after roughly 190 seconds: its recursively inspected timeline contains a private reasoning operation, zero Bash/work rows and zero public messages; BB then reported completed and the room correctly settled `no_reply`. `rooms-natural-stream-v2-run1.json` preserves that failure. At that point, model-composed streaming was still **unqualified**; the later Codex and Claude runs below closed that gate. This thinking-model entry was added only to the disposable VM's Pi configuration for an already available shared Ollama model. No personal credentials were copied during those Pi runs. Those acceptance gateways and task threads were stopped/archived, and the model window was then released for the Pi public-browser test.

## Reproduction and boundaries

Run from the candidate checkout inside its disposable VM after Turbo builds:

```sh
pnpm exec turbo run build typecheck test --filter=@bb/rooms
node apps/rooms/test/agent-cli.acceptance.mjs
ROOMS_ACCEPTANCE_CONTROLLED=1 ROOMS_TEST_MODEL=rooms-local/qwen3:4b-instruct-2507-q4_K_M node apps/rooms/test/runtime.acceptance.mjs
ROOMS_TEST_PROVIDER=codex ROOMS_TEST_MODEL=gpt-6.1-sol ROOMS_TEST_STEERING=native node apps/rooms/test/runtime.acceptance.mjs
ROOMS_TEST_PROVIDER=claude-code ROOMS_TEST_MODEL=claude-opus-5-5 ROOMS_TEST_STEERING=native node apps/rooms/test/runtime.acceptance.mjs
```

The harness owns port 38906, creates separate room data/workspaces, then stops its gateway before stopping and archiving its own BB threads. It removes invitation/activation credential files and workspaces and redacts bearer values from exported evidence. Restart and steering tests use actual BB execution; no provider transcript is copied into public messages. These tests use a trusted shared VM and capability-bound HTTP publication, not operating-system isolation between untrusted agents. A public author identity cannot be forged through the API, but a participant can still write misleading text or quote another person; independent identities cannot guarantee semantic truth.

## Authorized Codex and Claude qualification

The user subsequently approved copying Codex and Claude authentication into the disposable VM. Root performed the private transfer and verified guest authentication and actual BB model discovery: `codex` / `gpt-6.1-sol` and `claude-code` / `claude-opus-5-5`. The source credentials remain untouched. This runtime work reads neither credential file.

The natural harness retains the conversation, silence, authored public stream, restart and cancellation behavior requirements. `ROOMS_TEST_PROVIDER` and `ROOMS_TEST_MODEL` select each actual provider. `ROOMS_TEST_STEERING=native` requires a real accepted native steering receipt and actual agent-observed effect. An explicit `queue` mode is available to test rejection of unsupported steering and durable busy follow-up delivery. The recorded Codex and Claude qualification used `native` mode; queueing is not a substitute for proving their advertised input injection.

The first Codex run passed ten natural checks, including visible model-authored streaming and three separate append tool calls, then hit the expected HTTP 409 from the existing Pi-only Rooms steering guard. That failure is preserved as `rooms-natural-codex-v2-run1.json`. The minimal allowlist extension to Codex and Claude then passed Rooms build/typecheck/24 tests. The successful full native qualification runs below subsequently verified that correction and the later durability repairs. Model-authored streaming still requires at least three actual separate append tool calls and multiple public revisions; no scripted text or fallback mirroring is accepted.

## Durable native steering verification

A second audit found that an in-memory steering guard could vanish after a lost acknowledgment or gateway crash. The original request could then finish and release its activation before the delayed steering submission arrived. An actual Codex/BB transport proxy reproduced that defect against the retained pre-fix compiled gateway (`rooms-steering-lost-before-red2.json`). The fix records a unique steering ID, exact submitted text and bound activation/thread before dispatch; only exact native terminal admission proof or an atomically recorded successful cancellation settles that record. Missing outcomes fence the activation without replay. A delayed error cannot resurrect already settled work.

The first fixed run exposed a separate defect: owner recovery canceled unrelated queued human requests. That failing attempt remains in `rooms-steering-lost-before-green.json`. Recovery now fences active execution while preserving never-dispatched follow-ups; explicit Rooms Stop still cancels queued work.

Four actual-provider fault scenarios subsequently passed:

| Case | Evidence | Checks | What it establishes |
|---|---|---:|---|
| Lost ACK before native admission | `rooms-steering-lost-before-green2.json` | 7 | Original completion does not release unresolved steering; recovery rejects missing proof, then succeeds after late exact admission; queued human input executes afterward. |
| Gateway killed before admission | `rooms-steering-crash-before-green.json` | 7 | The same reservation and exact-proof recovery survive SIGKILL and gateway restart. |
| Lost ACK after actual admission | `rooms-steering-lost-after-green.json` | 6 | Real accepted steering remains fenced until owner recovery sees terminal proof; the later human request survives. |
| Delayed successful ACK | `rooms-steering-delayed-success-green.json` | 5 | A known in-flight send remains running rather than being prematurely fenced; its successful receipt allows normal completion and follow-up execution. |

The proxy changes HTTP delivery timing around the actual BB core; it does not fake the database, native event receipts or model execution. Only the gateway-crash case restarts the gateway; older generic assertion labels mentioning restart in the other fault files should not be read as additional restart executions. The test prompts request private observations, so these fault cases establish transport/lifecycle behavior rather than authored public composition.

## Qualified natural providers

Both provider runs below passed **15 executed checks** after durable steering was implemented:

| Provider/model | Evidence | Selected public story | Live input and cancellation |
|---|---|---|---|
| Codex / `gpt-6.1-sol` | `rooms-natural-codex-v2-run3.json` | Three actual separate authored append calls; observed message lengths 0 → 319 → 699 → 1111. | Native `delivery: sent` plus observed effect; Stop during a second authored stream leaves partial text stopped and rejects a delayed capability. |
| Claude Code / `claude-opus-5-5` | `rooms-natural-claude-v2-run2.json` | Three actual separate authored append calls; observed message lengths 0 → 498 → 1017 → 1643. | Native `delivery: sent` plus observed effect; the same active-composition Stop and stale-capability checks pass. |

Each run also proves two human identities, actual independent agent authors, parentless BB threads, more than two peer handoffs followed by idle, optional silence and gateway restart without duplicate publication. `qualified-provider-audit.json` independently checks source hashes, actual recursive append rows and both `sent` receipts. The harness now explicitly asserts the receipt field for future runs; that additional assertion was evaluated post hoc against these immutable successful traces rather than represented as a sixteenth executed check.

Claude's first run passed through native steering but failed a harness assumption that `sleep 30` would remain a foreground tool. Its tool policy rejected that wait and recommended background execution. The final cancellation scenario instead stops genuine ongoing public composition after its first visible append, preserving the meaningful Stop requirement without bypassing the provider's tool policy. The previous failure remains in `rooms-natural-claude-v2-run1.json`.

These are selected-content streams composed over successive tool calls, not fabricated typing delays or automatic forwarding of private provider tokens. The model composes each public paragraph before invoking append; tool-round-trip latency remains part of the behavior. Same-UID trusted-collaborator limits still apply. Provider credentials were copied only after explicit user approval and remain subject to removal at VM teardown.

## Final interruption and build checkpoint

The same broad-fencing policy was also present when BB reported an ordinary native interruption. A focused actual-BB test queued a second human request while a real Codex tool ran, interrupted the native thread directly, and reproduced the pre-fix loss of queued work (`rooms-native-interruption-red.json`). The final active-execution-only callsite passed all five checks in `rooms-native-interruption-green.json`: queued input survives and executes, the old activation stops, and no private output is published. Explicit Rooms Stop remains the separate action that cancels both active and queued room work.

The final source, including the uncertainty UI update, passed Rooms build/typecheck and **26 tests** (`rooms-qualified-green.log`). The full natural provider runs preceded only this narrow native-interruption callsite correction and UI update; the focused red/green test qualifies that correction without pretending another full provider rerun occurred. All task-owned gateways/proxies are stopped, all acceptance threads archived, and activation credential workspaces removed. Subsequent hosted-surface verification passed twelve mixed Codex/Claude conversation/control groups and each provider's natural public-stream case in two human browsers. The browser work also found and fixed a delayed-snapshot budget draft race, followed by another final build/typecheck/26-test run. These later UI-only changes do not imply a full native-provider rerun. Exact run boundaries and retained observer/approval-wait failures are recorded in the [browser evidence](../../../../validation/rooms-v2/ui/mixed-provider-acceptance.md).
