# Research claim review checkpoint

Reviewed 2026-10-09 while chapter writer prepared handoff.

The available chapter README and chapter04 did not overclaim Gas City runtime behavior. Chapters03 and06 had not yet appeared at this checkpoint, so no final review of their text is claimed.

Reference spike claims must remain: 46 top-level Go tests (55 pass events including subtests) with race detection and 88 Python tests against real pack functions with fake Slack/GC HTTP endpoints. Optional no-post behavior is part of the source prompt contract; these fixture tests do not prove that a live LLM chooses silence appropriately.

Read the separate BB explicit-participation throwaway broker, deterministic fixture and HANDOFF. Its current evidence boundaries:

- Authored message/capability scope and sequential negative fixtures are distinct from OS principal isolation or concurrent scheduler proof.
- Python HTTPServer serializes requests; no competing execution leases/fencing epochs are implemented.
- `request` and `post` currently call the same message function, and recipients are arbitrary IDs. Typed notification/ask/delegation authority and membership admission remain design work.
- Committing an already committed stream returns its old receipt before checking changed recipient or replyTo args. Thus same-request lost-ack retry is demonstrated, but conflicting commit retry is not rejected at this checkpoint. BB spike owner was notified.
- Persisted canceled capability fencing does not establish generic active-worker fencing after restart; HANDOFF acknowledges this.
- Scripted streamed chunks exercise explicit publication transport, not model-generated token streaming.

These are prototype scope limits and one concrete retry-validation defect, not reasons to equate the disposable spike with a production protocol. Sent to parent, BB spike owner and chapter writer before thread switch.
