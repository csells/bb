# Verify the executable participation boundary

An agent saying it sent a message is not evidence of publication. Neither is a successful shell exit by itself. The integrated spike exposed an executable-entrypoint defect that function-level CLI tests missed, followed by a separate model-usage failure after that defect was repaired.

## Inspect the actual tool path

The Pi source allowed its built-in Bash tool, and the actual HTTP request to Ollama advertised `read`, `bash`, `edit`, `write` and `update_environment_directory`. That ruled out a missing tool declaration for the captured request. It did not establish whether the model invoked the tool or whether the resulting process published anything.

BB timeline work rows can be nested under turns. An initial top-level inspection missed a real Bash call in natural attempt 6. The [recursive audit](../spikes/rooms-backend/recursive-tool-audit.json) records the source evidence and corrected counts: attempts 3–5 captured no command calls; attempt 6 captured a participation request with the agent's own philosophical question. Its process exited zero with empty output, and the public store contained no corresponding agent message. Earlier attribution of attempt 6 to poor model tool choice was incorrect.

## Test the copied executable

The compiled CLI guarded execution by comparing `import.meta.url` with the file URL constructed from `process.argv[1]`. Under macOS's `/var` alias, Node resolved the module to `/private/var`, while the argument retained `/var`. The guard skipped the program and exited successfully. The real acceptance harness used a temporary directory under that alias, so the defect affected its copied participation CLI.

Direct reproduction found that the original build's `--help` printed normally while the copied executable printed zero bytes. The fix uses a dedicated executable entrypoint importing the command implementation. The [compiled subprocess regression](../spikes/explicit-participation/runtime-v2/README.md) exercises the actual copied bundle, alias path, authenticated HTTP publication and visible invalid-command failure. A test that calls the exported implementation function alone cannot cover this boundary.

## Distinguish conversation from transport

After the fix, the unchanged natural harness observed independent Builder and Reviewer publications, more than two peer handoffs followed by idle, two top-level BB threads, and a second human's notice completing without a reply. Repeated questions within that run were distinct successful tool calls with new message IDs and `duplicate: false`; they were not transport retries or transcript mirroring.

The participation contract therefore needs explicit asynchronous semantics. A request returns a publication receipt and schedules the recipient; it does not return the recipient's answer. The sender can finish its current contribution, and a later addressed reply creates a new activation. Historical requests are context rather than unfinished work to repeat. This explains the actual execution model without imposing a hidden handoff limit.

The same natural run then failed streaming because the model repeatedly supplied an unsupported flag to `stream begin`. The command rejected it, and the model's later private story remained private. That is a separate failure from the repaired entrypoint: the CLI ran and rejected invalid input correctly. Useful error guidance and provider qualification must address it; silently accepting an ignored flag or publishing private prose would violate the contract.

## Evidence required at each boundary

Verify tool advertisement, an actual nested invocation, subprocess execution, an authenticated protocol receipt, durable message authorship, intended recipient delivery, and eventual settlement separately. A receipt proves acceptance, not peer observation. Correctly fenced private output proves the publication boundary, not a usable agent. The [verification report](../../validation/rooms-v2/README.md) keeps these claims separate while the remaining streaming and lifecycle gates run.
