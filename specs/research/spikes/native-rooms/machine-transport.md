# Native machine transport audit

October 10, 2026. This audit found an actual Add machine compatibility failure in the first authenticated gateway and a separate unsupported server-migration operation.

## Reachable controls and failure

The operator's Machines UI still invokes BB's existing APIs. `AddMachineDialog.tsx` creates a manual machine and retrieves `experimental_getEnrollmentCommand`. `services/machines/manual-enrollment-command.ts` produces a `/install.sh` or `/install.ps1` request carrying `X-BB-Enrollment`. The returned script downloads `/install/bb-app.tgz`, and `commands/machine-enrollment.ts` exchanges the one-use bearer at `/internal/hosts/enroll`. The daemon opens `/internal/session/open`, then `/internal/ws`; it also needs event, interaction, tool-call and artifact routes.

The initial gateway returned 403 for all those paths. This definitely breaks enrollment and reconnect when the machine-server URL points to the gateway. An already connected daemon on private loopback still works; an independently configured server-access transport can also work. Neither proves that the user-facing Add machine flow works at the preview origin.

Machine URLs do not come from browser Origin or forwarded headers. `services/machines/server-access.ts` uses Settings `machineServerUrl`, then `BB_EXTERNAL_URL`, for the direct provider. A selected server-access plugin supplies its own grant instead. Configure direct machine access with the reachable gateway origin; setting `BB_EXTERNAL_URL` cannot override an already persisted `machineServerUrl` or a selected plugin.

## Separate machine authority

The repair forwards only the following method/path combinations. Human Rooms sessions provide no machine authority. Internal bearer values reach BB's existing verifier, which remains authoritative for key validity, host binding, single-use exchange, session ownership and daemon protocol. The gateway strips every cookie and incoming trusted proxy/Connect header on this lane.

| Method/path | Existing core authorization |
| --- | --- |
| GET `/health` | Public health and server-move metadata |
| GET `/install/version`, `/install/bb-app.tgz` | Public installation artifacts, matching core behavior |
| GET `/install.sh`, `/install.ps1` | Require `X-BB-Enrollment`; core validates pending or reconnect bootstrap |
| POST `/internal/hosts/enroll` | One-use enrollment bearer, bound to the supplied host |
| POST `/internal/session/open`, `/events`, `/tool-call`, `/interactive-request`, `/interactive-request/interrupt` | Daemon host bearer; core validates payload/session ownership |
| GET `/internal/session/project-attachment-content` | Daemon bearer and core attachment authorization |
| GET `/internal/skills/tree/:hash` | Daemon bearer |
| GET `/internal/plugins/:pluginId/host/:digest` | Daemon bearer and core artifact lookup |
| GET `/internal/server-move/:moveId/archive`, `/bb-app.tgz` | Daemon bearer; only the move destination host can download |
| Upgrade `/internal/ws?sessionId=...` | Daemon bearer, BB daemon protocol and authorized open session |

All unlisted paths and methods remain denied. `/internal/hosts/enroll-key` and `/internal/server-move/pending` must never be forwarded from this ingress: their native authorization trusts the actual loopback peer, and forwarding would make a remote caller look local. Machine credentials cannot reach the operator `/api/v1` or browser socket lanes. Operator credentials cannot substitute for daemon credentials. Browser socket logout/expiry revocation remains unchanged; BB owns daemon session lifetime.

No Rooms body-size or browser-cookie CSRF requirement is imposed on these machine protocols. The exact allowlist and BB's bearer validation provide their boundary; public artifacts contain installation code, not user workspace data.

## Server move is not combined application migration

The operator's normal move check/start APIs were reachable. If a destination daemon used the gateway URL, the blocked internal download routes would fail during transfer. Forwarding those authenticated routes and preserving `/health` metadata repairs transport only.

`services/server-move/export.ts` snapshots BB's database and the roots listed in `packages/server-archive/src/server-owned-paths.ts`. That inventory excludes `ROOMS_DATA_DIR/rooms.sqlite` and the separate Rooms launcher/configuration. A moved core would also invalidate the gateway's fixed loopback upstream. The existing full-package launcher does not install or move the Rooms service.

The native gateway therefore rejects POST `/api/v1/server/move/check` and `/api/v1/server/move` with an explicit 409 explaining what would be left behind. The coordinated core lifecycle guard, enabled with `BB_ROOMS_SEPARATE_SERVICE=true`, also rejects export and move check/start through every core caller, including direct CLI/SDK calls. Exporting only BB data must not masquerade as a backup of the combined application. Normal BB without this mode retains its existing behavior. BB settings, machine addition and workspace features remain available. Implementing migration requires coordinated snapshots of both databases, service/configuration packaging, destination health for both services, credential/operator continuity, ingress cutover, and rollback before enabling these controls.

## Verification checkpoint

`apps/rooms/test/native-machine-access.test.ts` uses real HTTP and WebSocket connections and the existing core `createMachineAuthService` with a migrated in-memory database. Its red run failed at the valid installer assertion: expected 200, actual 403. It covers invalid, wrong-host and replayed enrollment credentials; daemon bearer preservation with cookie/trusted-header stripping; native API separation; machine socket round trips; and revoked, invalid or human-session tokens rejected at the upstream verifier. It also asserts the explicit move refusal and forwarded health metadata.

The coordinator's complete Rooms suite passed all 38 tests, followed by typecheck and build. [Combined evidence](access-evidence/native-machine-green-2.log). The transport regression's upstream invokes real core credential verification; the separate acceptance below proves a complete daemon connection to the actual candidate.

## Actual candidate acceptance

The [acceptance helper](machine-acceptance.py) ran entirely in the disposable VM against native gateway `http://127.0.0.1:38910`. It temporarily selected direct machine access, then used the same create-machine and enrollment-command API paths as the Add machine dialog. The generated command retrieved the authenticated installer. The helper extracted its bootstrap privately, downloaded the exact served host artifact, verified its SHA-256 header, and installed that package under a new task-private prefix.

The packaged `bb machine enroll` command successfully exchanged the one-use credential through the gateway. Replaying it returned 401. A separate packaged daemon then connected on its own reserved local port: BB reported the fixture host connected and active, and its persisted daemon session was active on protocol 231. An operator directory request returned a sentinel file from that daemon through an actual WebSocket RPC. The original QA host stayed connected. [Successful report](access-evidence/machine-acceptance.json).

Two preliminary harness failures are retained rather than counted as gateway failures. The source-checkout CLI could not resolve its bundled `fs-native-extensions` dependency; using the delivered package fixed that mismatch. The first packaged daemon launch omitted the explicitly reserved port and hit the already-used default; passing the same port argument as the real installer corrected it. Both failed runs removed their host records and restored settings. Their task-private directories were subsequently removed after checking that no matching processes remained. The successful run stopped its daemon, removed the host and private directory, and restored the prior machine-access settings automatically.

This verifies the actual candidate's machine enrollment, package delivery, native session and daemon transport via the underlying UI APIs. It does not claim interactive testing of the Add machine drawer or OS startup-service registration. No source-machine service, source credential or QA primary runtime was changed.

## Remote generic BB CLI authority remains separate

The machine lane deliberately rejects daemon credentials on `/api/v1`: a valid execution-host key is not a human operator login. `apps/host-daemon/src/start-host-daemon.ts` gives launched processes its server URL, or a loopback `machine-auth-proxy.ts` when explicit server-access headers exist. Direct enrollment does not provide a human operator credential. Consequently, generic `bb` CLI calls made on a newly remote host against this gateway need an explicit operator/client grant; successful daemon RPC is not generic remote CLI parity.

The room participation CLI uses an activation capability at `/api/agent/commands`, so it does not depend on a human session. Its `ROOMS_AGENT_ORIGIN` must be reachable from the execution host; the hosted preview uses its HTTPS origin for that purpose. Current multi-human/multi-agent acceptance uses one VM, and does not prove general BB CLI access from multiple hosts.

A proper extension should introduce an explicit execution-client principal/grant with stated scope and revocation, obtained through operator-authorized machine enrollment and supplied to the local CLI proxy. The server must validate that grant on permitted API/tool operations and bind it to the host/session where appropriate. Neither a caller-supplied Connect header nor automatic promotion of every daemon bearer to human-operator authority is an acceptable substitute. This needs its own boundary tests and an actual remote-host CLI/provider turn before claiming parity.
