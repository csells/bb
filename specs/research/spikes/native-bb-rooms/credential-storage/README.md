# Claude credential storage: failed dedicated Keychain spike

Observed October 10, 2026 in the task-owned macOS VM, using Claude Code 2.1.293. No source-machine credential grants, account logins or provider refresh calls were changed. This spike does not establish a durable Nova authentication fix.

## Why the copied credential file can disappear

Read-only inspection of the installed Claude executable found its Keychain-with-file-fallback update implementation. It writes Keychain first. When that write succeeds and the previous Keychain read returned null, it deletes the plaintext fallback. It does not verify a subsequent headless read before deleting the file. That mechanism is consistent with the recurrence evidence; it does not independently establish why the OAuth renewal was rejected.

The installed executable has no `CLAUDE_CODE_DISABLE_KEYCHAIN` switch. `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` namespace storage but still select the macOS Keychain backend; changing those directories alone would not remove this lifecycle problem. BB's current Claude declaration passes only `BB_CLAUDE_CODE_EXECUTABLE` and `CLAUDE_CODE_OAUTH_TOKEN` from the execution host's environment, so setting a configuration-directory variable there alone would not reach the bridge either.

Anthropic documents Keychain storage on macOS, fallback to a plaintext file when writes fail, and using `claude doctor` plus Keychain unlocking to diagnose access. A write succeeding is therefore not sufficient evidence that unattended read and update will work. [Official troubleshooting guide](https://code.claude.com/docs/en/troubleshoot-install#not-logged-in-or-token-expired).

Anthropic also documents a separately authorized `claude setup-token` credential for unattended model requests, supplied through `CLAUDE_CODE_OAUTH_TOKEN`. It requires a browser authorization flow and has a different lifecycle from a copied interactive login. This spike did not create one. [Official authentication guide](https://code.claude.com/docs/en/authentication).

## Isolated experiment

The intended storage was `/Users/admin/Library/Keychains/bb-rooms-stage.keychain-db`, with a random password in a mode-0600 task-private file. Original default and search-list paths were saved before changing them. The new Keychain was placed first in the search list; the existing login Keychain stayed intact. Timeout and sleep locking were disabled for the new Keychain only.

The first Security.framework attempt reported unlock success but settings access failed with OSStatus -25293. Sending the password to `security -i` through private stdin unlocked the same Keychain successfully. Neither argv nor logs contained passwords or credential values.

Separate launchd processes then exercised a random sentinel using the same `security` executable that Claude uses. Initial unlock, write and read passed. Updating the existing item timed out after 15 seconds. An explicitly trusted `/usr/bin/security` item and subsequent `apple-tool:,apple:` partition-list adjustment still failed the separate update test. Sanitized results are in `evidence/`; the helper is retained as the reproducible failed spike.

No Claude credential was inserted into the experimental Keychain, and the existing credential file was untouched. A successful sentinel read was not counted as successful OAuth renewal.

## Rollback and current state

Rollback restored the sole default/search-list entry to `/Users/admin/Library/Keychains/login.keychain-db`. The dedicated Keychain and its password were deleted. All probe LaunchAgents were unloaded. No periodic unlock job was installed. The task-private helper, original path metadata and sanitized logs remain for diagnosis; they contain no provider credential values.

The planned teardown command was `keychain-helper.py rollback`, which restores saved paths before deleting only the dedicated Keychain. It has already completed successfully. Do not rerun `create` without reviewing and archiving the previous metadata: its guard intentionally rejects reuse.

Remaining qualification: determine why separate headless updates lose access, or obtain independently authorized unattended provider credentials; then demonstrate a natural renewal and a subsequent BB-managed Claude turn. Recopying an unexpired access token establishes immediate availability only.

## Independent unattended authorization

The October 10 follow-up selected Anthropic's supported `claude setup-token` route. It issues a one-year subscription token through browser authorization and prints it without saving it over the interactive login. `CLAUDE_CODE_OAUTH_TOKEN` takes precedence over saved subscription credentials. Its scope is model requests: local tools and locally configured MCP servers remain usable, while Claude Remote Control and claude.ai connectors require broader login credentials. [Official authentication reference](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token).

This avoids relying on a copied interactive login's renewal. Anthropic documents coordination between parallel refreshes on one machine, not between independent copies in separate machines. The earlier copied-token repair established immediate availability but never proved unattended renewal. [Official troubleshooting reference](https://code.claude.com/docs/en/troubleshoot-install#not-logged-in-or-token-expired).

BB already passes this variable into its Claude bridge through the provider declaration and `packages/agent-runtime/src/provider-registry.ts`. The variable must be present in the candidate execution host process that launches the bridge. Merely setting it in the Rooms gateway process does not configure Claude.

The provider maintenance code previously ignored the environment token and reported an expired saved login as the active credential. A regression reproduced that error with synthetic credentials. The repair reports token-configured readiness with account and expiry unavailable, and returns unsupported usage instead of querying an unrelated saved account. All four credential-loading tests then passed in the VM (`provider-env-green.log`), followed by the provider package typecheck and coordinated build. An actual token-authenticated BB turn remains a separate check.

The task-owned [setup helper](setup-token-helper.py) runs the installed CLI with a fresh VM configuration under `/Users/admin/.bb-rooms-stage/private/setup-token-20261010`. It captures terminal output and the resulting token only in mode-0600 files, requests only the CLI-generated inference scope, and waits up to 30 minutes for browser authorization. The authorization code is requested through BB's secure secret form, then transferred privately for CLI consumption. No source grant is refreshed, no source login is replaced, and no browser cookies are copied. The first secure form timed out without input; no token was captured and active BB authentication is unchanged. A fresh user-completed authorization and secure form will be needed after the abandoned flow is cleaned up. Do not reuse an expired authorization URL.

The host's Chrome is running but exposes no listening debug port. No Chrome/session connector is available to this agent, and the installed chrome-agent has no registered instances. A user-completed authorization is therefore required with the currently available tools. This is required authentication input, not another permission request for the already authorized staging work.

At 19:02 UTC the setup flow expired without a token. Both helper and CLI processes were confirmed absent. The isolated setup directory, terminal capture, runner output and empty host secure-form directory were removed. [Sanitized cleanup evidence](evidence/nova-setup-abandoned.json) records the outcome. No further expiring form was opened while the user was unavailable; a new authorization must start with a fresh URL when they are ready.

For a future successful capture, load the token privately into the candidate execution host, restart only its idle provider runtime under coordinator control, and prove a new independent BB-managed Claude turn. Remove the one-time code file, private terminal capture and unused setup configuration after qualification, and remove the retained staging token at VM teardown. Never copy this staging token back over the source login.
