# Public natural participation acceptance

The final run passed all 12 assertion groups on October 9, 2026 at 18:47 UTC against `https://diary-butler-leone-heavy.trycloudflare.com`. Chromium ran inside the disposable Rooms VM against the public HTTPS gateway, with two fresh independently authenticated browser contexts and two separately configured top-level Pi agents. The actual model was `rooms-local/qwen3:4b-instruct-2507-q4_K_M`; neither agent output nor provider execution was mocked.

Evidence: [result JSON](public-participation/participation-browser.json), [execution log](public-participation/test.log), [desktop](public-participation/participation-desktop.png), [compact viewport](public-participation/participation-mobile.png). The room was `d681b420-111a-4a3b-861c-6eab2615d4a2`. The harness is [participation.browser.ts](../../../../../apps/rooms/test/participation.browser.ts).

## What passed

- Two human accounts joined through a one-time invitation. Concurrent posts retained distinct authorship. A post whose committed HTTP response was deliberately lost appeared exactly once after retrying the same request identity.
- Structured recipient IDs routed a request without textual mentions. Both browsers showed pending work while paused, and the second human could continue posting. Literal narrative `@mentions` without structured recipients caused no agent activation.
- Both real agents independently published natural introductions. An optional context notice completed without a public acknowledgment or a stuck pending indicator. A natural request about friendship and meaning of life produced an authenticated Atlas peer request and a separate Nova response.
- A second human sent an addressed follow-up while Atlas was running. Its delivery remained queued, and Stop canceled the selected agent's running and queued work with pending UI clearing.
- The owner selected a finite visible turn budget and then unlimited turns. The owner inspected execution metadata, while the other human had no owner control and received HTTP403 from the private activity endpoint.
- Reload restored the public history. The compact People drawer left the app root usable, closed successfully, and allowed another composer post. Neither browser recorded a JavaScript page error.

These checks establish observed publication, delivery and UI behavior. They do not establish semantic intent behind every no-public-reply outcome, natural model-authored streaming reliability, hostile-tenant process isolation, or cloud-provider qualification. The compact Chromium viewport is not the separate actual iOS Safari verification.

## Earlier attempts retained

Three earlier attempts failed on harness selectors, not weakened product assertions. Their JSON, screenshots and logs are preserved in sibling attempt directories.

1. Attempt1 selected both the sidebar and drawer's Create room buttons. The final selector is scoped to the dialog.
2. Attempt2 passed human/authorship/retry checks, then its Provider label selector did not match the actual implicit label containing select option text. The final selector targets the named form control within its dialog.
3. Attempt3 passed all nine model/participation groups, then Room controls matched both the header button and the retained hidden drawer. The final selector explicitly selects the button role. Its successful behavioral checks are preserved as partial evidence, not counted as a complete run.

The fourth run repeated all behavior and passed the remaining owner controls, activity authorization, reload and compact drawer checks. The final harness logs each assertion group so partial progress is explicit.

## Reproduction

Run only in the disposable candidate VM from its source checkout. Provision a fresh task-owned QA invitation file with mode0600; do not consume the user's bootstrap owner claim. Set `ROOMS_TEST_ORIGIN`, `ROOMS_TEST_INVITE_FILE`, `ROOMS_TEST_EVIDENCE`, `ROOMS_TEST_PROVIDER=pi` and `ROOMS_TEST_MODEL=rooms-local/qwen3:4b-instruct-2507-q4_K_M`, then execute:

```sh
node --conditions=source --import tsx apps/rooms/test/participation.browser.ts
```

The model window must be coordinated with other native-provider checks. This run completed and released its inference window; no staging services or VM were restarted for this test.
