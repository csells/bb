# Candidate runtime acceptance

This directory records verification of the implemented gateway, separately from the earlier throwaway broker spike. `apps/rooms/test/runtime.acceptance.mjs` starts the compiled gateway with separate data, two human accounts and two independent Pi threads in the disposable VM. Natural mode is the default. `ROOMS_ACCEPTANCE_CONTROLLED=1` supplies fixture commands and text; it cannot establish autonomous collaboration or model-composed streaming.

The natural assertions cover independently authored conversation beyond two peer handoffs, optional silence, model-composed public stream appends, gateway restart without execution replay, human steering observed during a real tool call, and cancellation fencing delayed publication. Natural conversation and silence now pass; streaming and the remaining live lifecycle checks are tracked separately below.

## Failures and corrections

- Attempt 1 exposed a harness launch race: passing an unopened log stream to `spawn`. Awaiting `open` fixed it.
- Attempt 2 exposed missing migration assets in the compiled gateway. The build now copies the same Drizzle directory used by the main server.
- Attempt 3 exposed the native events API's maximum page size of 100. The SDK accepted the string `500`, but the server rejected it. The activation correctly stayed reserved rather than completing from idle alone. The runtime now uses pages of 100.
- Attempts 4 (Qwen 2.5 7B) and 5 (Qwen 3 4B) had no work rows even after recursively inspecting the private timeline. Their private prose or printed command did not publish anything.
- Attempt 6 **did execute Bash** with a naturally composed `request --to @reviewer`. Its zero public messages were caused by our compiled CLI entrypoint, not by failure to choose the tool. An initial inspection missed work rows nested inside a folded turn; that diagnosis was incorrect.
- Controlled runs also contain nested Bash work rows, including quote-repair attempts. Their final CLI invocation exited successfully with no output because of the same entrypoint bug. They did not pass the runtime fixture assertions.

The decisive CLI reproduction: invoking the original bundle under `/Users/...` printed 1,464 bytes of help, while a copied bundle under `/var/tmp/...` printed zero bytes and exited 0. macOS resolves `/var` to `/private/var`, so comparing `import.meta.url` against `pathToFileURL(process.argv[1])` silently skipped the entrypoint. A dedicated executable entry module removes that comparison. `agent-cli.acceptance.mjs` exercises the actual copied bundle as a subprocess, including authenticated HTTP publication, selected multiline text and visible invalid-command failure.

## Proven recovery and tool availability

`rooms-status-recovery-run2.json` records five passed checks against a copy of a genuine accepted activation and the actual BB core: connectivity failure preserves the activation and exposes its error; repeated identical failures log once; a real terminal receipt clears the transient error and settles without a public reply; private provider text stays unpublished; and BB's event sequence does not change, proving no redispatch.

A task-local proxy captured actual request metadata for the same candidate through an isolated Pi provider alias. Qwen 3 4B received tools `read`, `bash`, `edit`, `write`, and `update_environment_directory`, with streaming enabled and no explicit `tool_choice`. Ollama advertised tool capability and a tool-aware template. The proxy recorded no prompt, headers or credentials. The alias and proxy were removed after the diagnostic. This rules out missing Bash advertisement in that captured invocation; it does not excuse the CLI defect.

## Post-fix actual participation

`rooms-natural-v2-run7.json` records independently authenticated humans, both actual agents publishing through their own CLI capabilities, both BB threads having no parent, a discussion extending beyond two peer handoffs and then becoming idle, and a second human notice completing without any additional public reply. Repeated questions in this run were separate authored CLI calls with distinct successful receipts, not transport replay. There is no automatic content deduplication or handoff cap. This run predates the later asynchronous-request/shared-goal wording clarification; a final browser conversation is responsible for checking that final prompt.

The same run failed the natural streaming gate: the model passed an incoming human message ID to `stream begin`, which correctly rejected that unsupported argument, then wrote the story privately. No public stream began and the private fallback remained private. The interface now explains that begin has no arguments, returns a new stream ID, and parse errors include valid CLI usage. The prompt also explains that requests return asynchronous delivery receipts, not blocking peer answers; later replies arrive in later activations.

`rooms-controlled-v2-run2.json` passed explicit independent fixture publication, top-level threads, silence, selected public stream revisions, and gateway restart with the same activation/thread and exactly one publication. It stopped at an erroneous harness assertion: steering was submitted as a fixture-file command, while the check looked for a marker located inside that file. Its retained snapshot shows the exact human command and the agent's `LIGHTHOUSE_TEAM` publication; the native receipt was `delivery: sent`. The assertion now compares the actual submitted human text and separately checks the agent-observed marker. `rooms-controlled-v2-run2-audit.json` independently derives actual private final text from recursive timeline rows and confirms none became a public message. Controlled fixture text and chunks are scripted and do not qualify autonomous composition.

`rooms-controlled-v2-run3.json` subsequently passed all 14 controlled checks, including actual native steering (`delivery: sent`) and agent-observed effect, stopping a real sleep tool, rejecting a delayed publication with HTTP 403, no post after cancellation, and comparison against actual private final strings. The fixture's public chunks and requested text are scripted; the real model invoked the fixture through its actual Bash tool, so this establishes runtime integration and lifecycle behavior rather than autonomous composition.

## Current checkpoint

The corrected CLI entry, asynchronous request guidance and visible parse help passed a fresh Rooms build, typecheck and 24 tests. The actual copied-bundle subprocess acceptance passed four checks. The broader CLI suite previously passed 857 tests with one skip. Native steering includes the immutable activation marker, and pending receipt errors become visible after a bounded grace period without releasing or replaying uncertain work. The final shared-goal prompt wording passed another Rooms build/typecheck/24-test run and copied compiled CLI checks (`rooms-final-runtime-green.log`, `rooms-cli-final-v2.json`). Controlled lifecycle verification is complete. The final fresh-agent natural streaming attempt using `rooms-local/qwen3:4b` failed the unchanged observable-stream assertion after roughly 190 seconds: its recursively inspected timeline contains a private reasoning operation, zero Bash/work rows and zero public messages; BB then reported completed and the room correctly settled `no_reply`. `rooms-natural-stream-v2-run1.json` preserves that failure. Model-composed streaming remains **unqualified**. This thinking-model entry was added only to the disposable VM's Pi configuration for an already available shared Ollama model. No personal credentials were copied. All acceptance gateways and task threads from these runs are stopped/archived; the model window is released to the final public-browser test of the instruct model.

## Reproduction and boundaries

Run from the candidate checkout inside its disposable VM after Turbo builds:

```sh
pnpm exec turbo run build typecheck test --filter=@bb/rooms
node apps/rooms/test/agent-cli.acceptance.mjs
ROOMS_ACCEPTANCE_CONTROLLED=1 ROOMS_TEST_MODEL=rooms-local/qwen3:4b-instruct-2507-q4_K_M node apps/rooms/test/runtime.acceptance.mjs
ROOMS_ACCEPTANCE_STREAM_ONLY=1 ROOMS_TEST_MODEL=rooms-local/qwen3:4b node apps/rooms/test/runtime.acceptance.mjs
```

The harness owns port 38906, creates separate room data/workspaces, then stops its gateway before stopping and archiving its own BB threads. It removes invitation/activation credential files and workspaces and redacts bearer values from exported evidence. Restart and steering tests use actual BB execution; no provider transcript is copied into public messages. These tests use a trusted shared VM and capability-bound HTTP publication, not operating-system isolation between untrusted agents. A public author identity cannot be forged through the API, but a participant can still write misleading text or quote another person; independent identities cannot guarantee semantic truth.
