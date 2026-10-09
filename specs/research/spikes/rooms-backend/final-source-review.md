# Focused source review during Safari qualification

2026-10-09. Read-only source review; no VM operation or credential access. This review extends the earlier protocol/admission audit rather than repeating it.

## Findings sent to owners

1. **SSE checked a different token from initial authentication when both cookie and Bearer were supplied.** Middleware preferred Bearer, while the stream selected its cookie first. A stream authorized as the Bearer user could keep authenticating an unrelated still-valid cookie after the Bearer token was logged out. Root fixed this with one bearer-first extraction path for middleware, logout and SSE and added a real-DB mixed-token logout regression. Its coordinated VM run remains the authority for test status.
2. **Rejected steering still created a public human post.** The route wrote the message before runtime steering rejected an idle or unsupported agent. Root moved publication after acknowledgment and added an idle-agent regression. Lost native acknowledgments remain inherently ambiguous; this fix does not assert transactional exactly-once external steering.
3. **Typed SDK receipts were incomplete.** The human `send`, `stop`, `recover` and `steer` helpers still returned generic `unknown` while the newer room/policy/agent-command methods parsed concrete contracts. Root added `roomsPublicationReceiptSchema`, reused it in the agent-result union and human send parser, and added local typed action receipt schemas. Coordinated VM build remains pending at this review checkpoint.

No further concrete author/room/recipient substitution issue was identified in the owned store/protocol path. Human membership is checked before publication, agent authorship derives from activation capability, malformed routing targets reject before commit, stream ownership is activation-bound, pause blocks new claims while preserving work, and lease release is separate from publication settlement. This statement is source-review scope, not an additional executed acceptance claim.

## Pi tool-advertisement investigation

The checked-in Pi RPC launcher includes mode/session/model/extension settings and does not pass `--no-tools` or restrict `--tools` (`plugins/provider-pi/src/bridge/rpc-session.ts`). Its extension unions injected tools into the existing active set rather than replacing the built-ins (`bb-pi-extension.ts`). The task's saved local provider configuration uses the OpenAI-completions adapter; its compatibility flags disable developer-role, reasoning-effort and store fields, not tools.

A subsequent recursive audit corrected the initial top-level inspection. Attempt6 contains an actual command-tool work row nested under a turn (`privateTurns.failure-builder.rows[2].children[0]`). It invokes the activation-specific participation launcher with `request --to @reviewer`, returns exit code0, and has empty output. Pi maps Bash to command work rows. Thus Bash was exercised in this candidate configuration; describing attempt6 as private prose only, or attributing its failure to model incapability, was incorrect.

| Preserved attempt | Captured private threads | Recursive command-tool calls | Participation launcher calls | Public agent messages |
| --- | ---: | ---: | ---: | ---: |
| 2 | 0 | 0 | 0 | 0 |
| 3 | 1 | 0 | 0 | 0 |
| 4 | 1 | 0 | 0 | 0 |
| 5 | 1 | 0 | 0 | 0 |
| 6 | 1 | 1 | 1 | 0 |

Attempt2 failed gateway startup and contains no private transcript; zero captured calls is not a model-behavior observation. Counts cover the preserved private snapshots, recursively including all turn children. They do not assert an unseen thread had no tool calls. Attempt5 contains a literal `post --text` in assistant text, which is not counted as execution. [Machine-readable counts and source hashes](recursive-tool-audit.json).

The runtime owner identified a product defect consistent with attempt6's zero-exit/empty-output launcher: the copied agent CLI checked `import.meta.url` against the noncanonical argv path, so macOS `/var` versus `/private/var` aliases could skip its entrypoint entirely. The owner is fixing the executable boundary and rerunning real acceptance. This audit independently confirms the attempted launcher call and outcome; the repaired subprocess test/live rerun establishes the root-cause fix. Natural collaboration qualification remains failed/pending, but model incapability has not been established. Preserve failed runs and distinguish controlled fixture runs from autonomous qualification.
