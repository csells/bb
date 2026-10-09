# Provider preparation in the disposable Rooms VM

2026-10-09: installed and verified Codex CLI **0.159.1** and Claude Code **2.1.293**, matching the `buzz-stage` registry's proven CLI versions. Both binaries resolve under `/opt/homebrew/bin` in the Rooms VM. Guest platform is macOS26.6.2 arm64 with Node24.20.0/npm11.19.0 and75GiB available disk. These are CLI installation checks, not successful model runs.

No source authentication files or Keychain credential values were read or copied. Codex reports `Not logged in`; Claude reports `loggedIn:false`, `authMethod:none`. Credential-copy approval was pending at this checkpoint. No BB core restart, provider source edit, or stable-machine install/configuration change occurred.

Installed with version-pinned official npm packages:

```
PATH=/opt/homebrew/bin:$PATH npm install --global --prefix /opt/homebrew @openai/codex@0.159.1 @anthropic-ai/claude-code@2.1.293
PATH=/opt/homebrew/bin:$PATH npm install --global --prefix /opt/homebrew --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code@2.1.293
```

The second command fixed npm11's warning that Claude's package postinstall was not yet authorized; it granted permission only to that package's script. [Initial output](install-initial.log), [successful correction](install-script-fix.log). An initial version-check command lacked `/opt/homebrew/bin` on PATH and could not resolve Node through Codex's shebang; corrected checks pass with the PATH prefix.

BB's checked-in Codex provider requires at least0.136.0 (rewind requires0.143.0), so0.159.1 satisfies those declared version floors. Account/model availability remains unverified. Official [Codex installation guidance](https://help.openai.com/en/articles/11096431) supports npm installation. Official [Claude setup](https://code.claude.com/docs/en/setup#install-with-npm) supports npm, requires Node22+, and installs a native platform binary. Registry `bb-rooms-stage` revision8 records the CLI versions, `not_authenticated` state, in-progress replacement, failed natural local-model qualification, replacement data path, and pending owner-claim repointing. Historical prototype notes are explicitly superseded and preserved. The parent will update final metadata after acceptance.

## Authentication procedure, only after explicit approval

This procedure has not been executed. It copies only provider authentication needed by the disposable runtime; it does not copy source histories, projects, plugins, hooks, or general CLI configuration.

1. Confirm the user's approval covers copying existing Codex/Claude authentication into this VM. Resolve the source Codex auth-cache path from its configured home, normally `/Users/csells/.codex/auth.json`. Confirm the file exists without displaying its contents.
2. Send the Codex file over the existing pinned SSH transport as standard input, writing to a mode0600 temporary file under mode0700 `/Users/admin/.codex`; validate JSON without logging fields, then atomically rename to `auth.json`. Do not pass tokens in command arguments, print subprocess stdout containing credentials, or place an intermediate file in the repository. Official [Codex authentication documentation](https://developers.openai.com/codex/auth#fallback-authenticate-locally-and-copy-your-auth-cache) explicitly describes this headless cache-copy method. If source auth resides only in the OS credential store, stop this file-copy branch rather than changing the user's source configuration.
3. For Claude, prefer an existing source `.claude/.credentials.json` if present. Otherwise retrieve the existing macOS Keychain item `Claude Code-credentials` using `security find-generic-password -s 'Claude Code-credentials' -a csells -w` inside a process that captures stdout in memory and immediately feeds the SSH subprocess's stdin. Never print that captured value. The checked-in BB Claude provider recognizes that service and file fallback. Write only the received JSON into mode0600 `/Users/admin/.claude/.credentials.json` beneath mode0700 `.claude`, atomically. Official [Claude credential management](https://code.claude.com/docs/en/authentication#credential-management) documents macOS Keychain storage and the0600 file fallback for unavailable Keychain access; a custom `CLAUDE_CONFIG_DIR` changes those locations and must be handled explicitly rather than guessed.
4. Run `PATH=/opt/homebrew/bin:$PATH codex login status` inside the VM. Run Claude `auth status`, parsing its output to report only `loggedIn` and `authMethod`. Do not run a source-machine login/logout or copy refreshed VM tokens back. Failure or expiry is a reported authentication failure, not permission to replace the source account's login.
5. Let the integration owner verify BB provider discovery and actual account model access inside the candidate VM, then execute real room participation acceptance. Installing a CLI or recognizing its credentials does not establish tool-use correctness.
6. At teardown remove the two task-added authentication files and any task-created Keychain entries before discarding the VM. Preserve the source machine's credentials and stable services. Record removal in the staging registry and exclude authentication from exported logs/artifacts.
