# Credential recovery from the working Mac mini

October 10, 2026. Chris explicitly authorized copying working provider credentials from the Mac mini that runs BB. The transfer copied only Codex authentication and Claude OAuth credentials over pinned SSH standard input, held secrets in process memory, and atomically installed mode0600 files beneath mode0700 directories in the disposable Rooms VM. No source credentials, source services, histories or general provider configuration were changed. The exact task-owned inaccessible guest Claude Keychain item was removed before restoring its fallback file.

Codex and Claude both recognized the restored login. Claude access metadata expires at2026-10-10T20:43:50.503Z; Codex access metadata expires at2026-10-20T16:30:20Z. These times are metadata, not guarantees of authorization or renewal. The credential values are excluded from evidence.

## Actual verification

The [browser harness](debate.browser.mjs) created a separate QA room and two independently authenticated human accounts in the existing public preview. Real Codex and Claude agents ran through Rooms and native BB sessions. Each posted its own view on the meaning of life and one response to its peer. Four independently attributed public messages appeared identically in both browsers. Six deliveries settled successfully: four replies and two silent completions. The conversation was quiet after a further three-second observation. No browser errors or provider approval occurred. The screenshot was visually inspected.

See [result](run1/result.json), [public snapshot](run1/snapshot.json), [two-human screenshot](run1/owner.png), [transitions](run1/observations.json), and [log](run1/test.log). [Guarded cleanup](run1/cleanup.json) archived only the two idle QA native threads and deleted the exact QA room, its two exclusive users and workspaces. Workshop's public history and membership remained unchanged. Both browser sessions logged out and the browser closed.

The existing Workshop threads also received an explicit private authentication check through the BB SDK, instructing them not to use tools, publish, or resume old work. Both completed successfully in their original provider sessions and returned to idle. [Native completion evidence](workshop-native-check.jsonl). No old public prompt was replayed and no new human message was published. Existing failed-attempt cards remain historical records.

## Renewal remains a separate gap

Inspection of the installed Claude2.1.293 executable's credential-storage implementation shows that a successful write to its primary Keychain store can delete the plaintext fallback when the previous primary read returned absent. This matches the observed missing fallback and newly created Keychain item at the failed turn, but it is not a trace proving the exact path taken. The earlier OAuth refresh rejection could still involve access to credential storage, refresh-token rotation or another authorization failure.

This transfer and the actual model checks prove restored current access. They do not prove unattended expiration/refresh or authorize changing the source Mac's credential lifecycle. No forced refresh of the shared source grant was attempted. Task-added authentication must be removed at VM teardown; refreshed guest credentials must never be copied back to the Mac mini.
