# Provider authentication failed again overnight

Read-only diagnosis on October 10, 2026, at 15:09–15:10 UTC (08:09–08:10 Pacific). No provider sessions, credentials or user history were changed, and no model request was retried.

Both copies of Chris's “Can the two of you debate the meaning of life for me?” message reached both agents. Delivery records show native turns started and then failed, so these failures are not room-routing suppression or deliberate silence.

## Nova

The BB SDK event query for `thr_ghwyvj3ihy` reports `Failed to authenticate: OAuth session expired and could not be refreshed` at sequence79 and92. Their matching terminal events80 and93 are failed, for turns `da94444e64-t1` and `da94444e64-t2`. The latest error occurred at15:08:34 UTC, immediately after the second public request.

Yesterday's restored Claude access credential was recorded to expire at05:46:59 UTC today. Its fallback credential file is now absent. A `Claude Code-credentials` Keychain item for the staging account exists, with creation and modification time15:08:11 UTC today, matching the first failed turn. Reading Keychain settings returns exit36: `User interaction is not allowed`. Only metadata was inspected; no credential values were printed or exported.

These observations establish another failed OAuth renewal and recurrence of the staging credential-storage problem. They do not distinguish whether credential migration/access, a rotated refresh token, or another OAuth rejection caused renewal to fail. Yesterday's credential replacement restored immediate access; it did not qualify unattended renewal. Repeating that replacement alone would not resolve this lifecycle gap.

## Atlas

The same requests also fail in `thr_fbhp67gj3i`. Latest terminal event94 follows error93: `workspace routing discovery unauthorized (401)`, after five reconnect attempts. The provider categorizes this as `stream-disconnected`, which makes the current Rooms summary misleadingly describe a temporary connection failure. The raw diagnostic establishes authorization rejection; its underlying cause remains unproven.

## Required correction

Establish durable, independently renewable staging provider authentication through BB, including credential access from its supervised headless processes. Verify an actual expiration/refresh cycle and subsequent BB-managed turns, rather than counting a freshly copied access token as the lifetime test. Inspect Atlas's authorization rejection separately. Correct the public classification of its explicit401 diagnostic when implementing that repair. The existing routing and public-participation contract needs no change based on this incident.
