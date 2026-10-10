# Native Rooms CLI acceptance

October 10, 2026. The [reproducible helper](cli-acceptance.py) exercised the actual built BB CLI against the authenticated native gateway at `http://127.0.0.1:38910`, entirely inside the disposable VM. It read the operator session from a private token file; no token, password or provider credential appeared in argv or evidence.

The following commands returned successfully and their persisted results matched the supplied context:

- `bb rooms ... create NAME --project PROJECT --environment ENVIRONMENT --section SECTION`
- `bb rooms ... context ROOM --file context.json`, changing the room's section while preserving its project and environment
- `bb rooms ... list` and `show ROOM`, returning the new association
- `bb rooms ... policy ROOM --file policy.json`, pausing dispatch
- `bb rooms ... agent-add ROOM --file agent.json`, attaching an existing native thread and preserving its authoritative project/environment
- A final `show ROOM`, confirming the attachment

The native thread was a disposable fixture scheduled for the next day. It remained inactive and was deleted immediately after attachment; no provider turn was started. This checked the actual CLI argument parsing, experimental SDK client, HTTP routes, native association validation and persisted data rather than help text alone.

Cleanup removed only the newly created room/binding/member rows, its native thread and queued work, two new native sections, and private fixture files. Existing project/environment data and binding-proof agents were left in place. Room deletion is not yet a public endpoint, so the fixture cleanup used exact room-ID SQLite statements after asserting zero messages and activations. The [sanitized result](access-evidence/cli-acceptance.json) records all seven successful CLI invocations and cleanup outcomes.
