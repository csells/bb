# Failed-agent visibility and handle validation

The conversation previously removed a delivery’s pending card when its state became `error`. The participant badge still showed “Failed,” but the failure reason and any useful action disappeared.

The compiled UI now retains a failure card containing the agent, original request, and the existing public `delivery.error` summary. Missing summaries receive an explicit fallback. “Ask [agent] again” selects only that agent and prepares the original request when the draft is empty; it preserves an existing draft and never submits automatically. Room owners also get an Activity shortcut. This UI does not fetch private transcripts.

Both sign-in and Add agent now use the same handle pattern with an escaped literal hyphen. Chromium’s Unicode-set pattern parsing previously rejected the unescaped class and silently failed to enforce invalid-handle rejection.

## Evidence

- `failure-ui-red/test.log`: pre-fix rendered browser failure; the participant said Failed while the conversation contained no failure card.
- `handle-ui-red/test.log`: failure card regression passed, then the actual Add agent input accepted an invalid handle because its pattern was invalid.
- `failure-prefill-red/test.log`: initial follow-up button left an empty composer instead of preparing the original request.
- `failure-ui-final-build.log`: Turbo build/typecheck and 27 Rooms tests passed in the disposable VM.
- `failure-ui-final-chromium/` and `failure-ui-final-webkit/`: 14 browser groups passed in each engine, including persistent error text after reload, absent-summary fallback, empty/nonempty draft behavior, no automatic publication, owner-only Activity, valid/invalid handles, and existing permissions, steering controls, pending states, and compact layout checks.
- `client-sha256.txt`: exact minified UI checked; the subsequent backend-only rebuild produced identical client hashes.

The browser fixture supplies synthetic HTTP responses to the actual compiled application. It verifies presentation and interaction, not provider authentication or execution. The parent task separately diagnoses Nova’s provider failure and verifies the repaired live provider. No stable service, live user room, or shared gateway was changed by this UI subtask.

The disposable static server used `apps/rooms/dist/web` on loopback port 38902 and was stopped after verification. An evidence-only fixture correction supplies the proper Activity response and waits for the retained drawer to leave the viewport before capturing the failure card.
