# Explicit-participation candidate verification

Checkpoint: October 9, 2026. The hosted replacement passed the combined public browser flow with two humans and two real independent agents, including a finite peer conversation through the CLI. **Full requested qualification remains incomplete:** natural model-authored streaming has not passed. A deeper trace found and fixed an executable-entrypoint bug under macOS's `/var` alias; earlier attribution of that failure to model tool choice was premature. Codex and Claude Code are installed but unauthenticated; their credential-copy permission remains pending.

## Verified candidate behavior

| Layer | Actual evidence | Scope |
| --- | --- | --- |
| Build and contracts | Turbo build/typecheck/test passed; 24 Rooms tests, 857 CLI tests, one skipped. [Log](build-and-tests.log) | Compiled candidate, shared schemas, real SQLite migrations and authority/protocol tests. |
| Copied agent CLI | Four actual compiled-subprocess checks passed after the entrypoint fix. [Runtime evidence](../../research/spikes/explicit-participation/runtime-v2/README.md) | Alias path, executable help, authenticated HTTP publication and visible invalid-command failure. Final runtime build/typecheck/24 Rooms tests passed after the last prompt clarification. |
| Separate humans | Eight public HTTPS browser groups passed. [UI report](ui/README.md) | Separate accounts and invitations, concurrent attributed posts, retry identity, persistence, anonymous/forged rejection, live membership revocation. |
| Combined public experience | Twelve public HTTPS browser groups passed on the final build and prompt. [Participation report](ui/public-participation/README.md) | Two humans, two real Pi agents using Qwen 3 4B Instruct, independently authored replies and peer requests, notice silence, busy follow-up queue, Stop, owner controls and activity authorization, reload and compact layout. |
| Pending and streaming UI | Chromium and Playwright WebKit passed the final minified client. [UI report](ui/README.md) | Synthetic room snapshots: pre-output pending cards, transient error visibility/recovery, explicit stream bubbles, terminal clearing, usable composer and drawers. |
| Actual iOS Safari | iPhone 17 Pro / iOS 27 Simulator XCUITest passed. [Safari report](ios-safari/README.md) | Real Safari keyboard, input zoom, drawer closing, deferred/persistent content and app-root usability. Final minified CSS received separate WebKit regression checks. |
| Native execution recovery | Five checks passed using an actual accepted/completed BB activation. [Runtime evidence](../../research/spikes/explicit-participation/runtime-v2/README.md) | Lost connection visibly retains the execution lease; repeated errors are deduplicated; recovered terminal proof clears the error without redispatch or publishing private output. |
| Natural agent dialogue | Six checks passed in natural run 7. [Runtime evidence](../../research/spikes/explicit-participation/runtime-v2/README.md) | Separate humans and actual agent authors, top-level BB threads, more than two peer handoffs followed by idle, optional notice with no public reply. This run predates the final asynchronous-request wording. |
| Native lifecycle | Fourteen controlled checks passed in run 3. [Runtime evidence](../../research/spikes/explicit-participation/runtime-v2/README.md) | Real agents invoked supplied commands: private output exclusion, explicit streams, restart without replay, native live steering with observed effect, Stop and stale-capability rejection. Scripted text is not natural composition. |
| Tool advertisement | Actual Pi-to-Ollama HTTP metadata included `read`, `bash`, `edit`, `write` and `update_environment_directory`. [Runtime evidence](../../research/spikes/explicit-participation/runtime-v2/README.md) | The candidate did advertise Bash. This does not establish reliable model tool selection. |

The earlier [scratch broker](../../research/spikes/explicit-participation/HANDOFF.md) and [Gas City reference](../../research/spikes/gascity-reference/README.md) checks are separate evidence. Supplied-command fixtures do not count as model-authored conversation or streaming.

## Gates still open

Natural model-authored streaming still must pass. The final public browser suite passed all twelve groups at 18:47 UTC. Native lifecycle behavior has passed separately using controlled commands. No generated private transcript may substitute for an authenticated publication.

Initial Qwen runs could not establish model unreliability while the copied CLI silently skipped execution. After that fix, dialogue succeeded and a separate natural streaming attempt failed through unsupported CLI arguments. Invalid input was rejected and the private fallback story stayed private. CLI help and asynchronous delivery guidance were improved. A fresh-agent attempt using Qwen 3 4B's thinking variant then finished privately with zero tool calls and zero public messages; it correctly settled without a reply. Failed runs remain preserved alongside their corrected diagnosis. Controlled chunk publication proves the stream protocol; it does not close the natural streaming gate.

## Hosting and isolation

Execution, builds, data and agent workspaces remain in the disposable Rooms VM. The temporary Safari VM was deleted after exporting evidence. Stable BB and Buzz were not modified. The supervised host HTTP relays expose the VM and the owner-only initial claim; the claim now uses fresh replacement data and its token remains unconsumed. Current endpoints, lifecycle and authentication state are maintained in the home-lab registry record `bb-rooms-stage`. The [hosting checkpoint](hosting.md) explains supervision and the temporary tunnel's restart limitations.

The user authorized replacing this disposable preview. No stable BB merge or promotion has occurred. The preview uses separate agent directories under one OS account and is intended for trusted collaborators, not hostile tenants.
