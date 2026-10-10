# Native Rooms access boundary

Source inspection: October 10, 2026. This document records observed implementation and a proposed boundary. It does not claim runtime verification of the native integration.

## Existing authority

BB is an operator application. Its core HTTP server does not currently identify individual human users on general public API requests. `apps/server/src/server.ts` registers every project, thread, file, environment, host, terminal, plugin and settings route under `/api/v1`. The guard checks request host and browser origin. Those checks prevent browser-origin abuse; they do not distinguish people or grant room membership. Some sensitive operations additionally distinguish Connect machine access from owner sessions, but that is not a general human authorization system.

The browser `/ws` endpoint similarly checks origin, then `ws/client-protocol.ts` accepts subscriptions directly. `NotificationHub` records sockets and subscription keys without a human principal. `/ws/terminals/:terminalId` attaches a terminal after the same origin check. A room member must not receive either socket simply because they can load BB's JavaScript.

`/internal/*` uses bearer-authenticated daemon keys, with explicit enrollment and WebSocket exceptions. `/internal/ws` authenticates its own upgrade. These are machine authority, not human room identity. The later [machine transport audit](machine-transport.md) separates authenticated machine transport from the browser operator gate.

Connect's worker strips incoming `x-bb-gate-*` and tunnel-routing headers, verifies its own account or desktop session, and rejects a person whose account does not own the target server (`apps/connect/src/worker.ts`). This protects an owner's remote BB. It does not supply collaborator identities or room-level access. A plain public tunnel cannot trust caller-supplied Connect headers.

The Rooms implementation already has independent humans: salted password hashes, hashed session tokens, single-use invitations, per-room membership and server-derived authorship in `apps/rooms/src/store.ts` and `app.ts`. Its SSE endpoint reauthenticates the exact session and membership every 500 ms. A failed check emits an access error and ends the stream. Agent activation capabilities authenticate in a separate authority domain and cannot serve as human sessions. Every signed-in human can create a room, so being a room owner is explicitly insufficient to establish BB operator privilege.

## Integration decision proposed

Keep one actual BB frontend, including native Rooms navigation and views. Use the authenticated Rooms ingress as an access boundary in front of that frontend and the existing private BB core. Serving the real `apps/app` build is materially different from embedding the standalone Rooms application. Owner terminals, files, settings, plugins, threads and provider controls must use their existing BB routes and components.

Make BB operator identity an explicit server-side binding to an existing human user ID. Do not infer it from a handle, request field, first login, room creation, a room-owner role, a forwarded header or a user-selected environment. Preserve Chris's existing human identity when binding it. All other humans begin as room collaborators. More granular project/resource sharing remains a separate grant; it must never happen implicitly through room membership.

| Interface | Anonymous | Room collaborator | Bound BB operator |
| --- | --- | --- | --- |
| BB static shell/assets and login | Load | Load | Load |
| Room list and public history | Denied | Own memberships only | Own memberships only |
| Room message and explicit publication | Denied | Authenticated human identity | Authenticated human identity |
| Room administrative controls | Denied | Only rooms they own | Only rooms they own |
| Private agent activity/approvals | Denied | Denied unless explicitly granted | Existing operator controls |
| `/api/v1/*` native BB APIs | Denied | Denied | Existing BB behavior |
| `/ws` native notifications | Denied | Denied | Existing subscriptions |
| `/ws/terminals/*` | Denied | Denied | Existing terminal protocol |
| Plugin WebSocket endpoints | Denied | Denied | Existing BB behavior |
| Allowlisted machine transport | BB machine credential required | Human session supplies no authority | Human session supplies no authority |
| Local-only enrollment-key and move-pending endpoints | Denied | Denied | Denied |

HTTP and upgrade authorization must run before forwarding. Unknown API/upgrade routes fail closed. Strip caller-provided proxy authority, host, origin and Connect routing headers; synthesize only the local upstream headers needed by BB's existing origin guard. Forward no Rooms credential to the core unless core has an explicit authentication contract for it. Runtime-to-BB SDK traffic stays on the private loopback interface and does not impersonate a human browser.

For operator sockets, an accepted upgrade is not permanent authority. Recheck the same session during its lifetime and close both sides on logout, expiry or loss of operator grant. Existing Rooms SSE already does this for room sessions and memberships. Do not add room guests to the core notification hub and try to filter its global event stream afterward.

The core must remain private to the disposable staging VM. A public hostname routed straight to the core would bypass this entire boundary. The native frontend needs an explicit session/bootstrap result so it does not initialize global BB queries, plugins and sockets before it knows the human's role. Hiding buttons is supplementary; the ingress enforces access independently.

## Required spike evidence

1. Two actual users independently authenticate. Their valid message writes have different server-derived author IDs. A submitted `authorId` is rejected.
2. The bound operator can load native project, section, thread, file and settings APIs and establish the real notification and terminal paths.
3. The guest can read/write only joined rooms. Direct native API calls, guessed private thread IDs, native WebSocket upgrades, terminal upgrades, plugin upgrades, internal routes and spoofed operator/gate headers are rejected.
4. A room owner who is not the configured operator still cannot access unrelated BB APIs.
5. Removing guest membership terminates an already-open room stream and rejects later writes. Expiring or logging out an operator session closes already-open native sockets and rejects subsequent HTTP calls.
6. The rendered full BB shell works for the operator without using a replacement files/terminal/settings UI. The scoped room route works for a guest without leaking unrelated project/thread names into responses or bootstrapped data.

Use the real migrated Rooms database for identity/membership and real network upgrades for socket evidence. A test that only asserts a middleware helper's return value does not prove the exposed server boundary.

## Implementation contract selected

The native ingress uses `ROOMS_NATIVE_APP_DIR` to serve the actual built BB application and `ROOMS_OPERATOR_USER_IDS` as a comma-separated, explicit list of existing human IDs. Missing or empty operator configuration fails startup in native mode. `ROOMS_BB_URL` continues to identify the private core, and `ROOMS_PUBLIC_ORIGIN` supplies the allowed browser origin. The ordinary standalone test harness remains supported without native configuration.

`GET /api/v1/rooms/session` identifies the ingress before the frontend mounts BB's global queries, plugins and sockets. It returns `{enabled:true,user:null,access:{operator:false}}` before login, or the authenticated user and operator grant afterward. The unmodified BB server returns 404 for this endpoint; only that explicit absence disables the native session gate. Existing authenticated `/api/me` also includes `access.operator`. Other failures must not be interpreted as authority to initialize the operator application. The `/api/v1` prefix is intentional: BB's generic static fallback returns 200 HTML for unknown paths outside that namespace.

Native room guests may own empty rooms and manage those memberships. Associating a project/environment/section, creating or attaching any agent, reading private activity, resolving native interactions, viewing the provider catalog or recovering native execution requires the operator grant. Room ownership does not change it. Stop and steering also require operator access in this first native slice because BB's current thread stop is not atomically conditional on the room-owned turn. Room guests can still publish public messages and request participation.

The transport contract tests use a controlled loopback upstream to observe exact forwarded HTTP bytes and WebSocket frames, a migrated in-memory Rooms database for real identities, and actual listening network servers. This isolates ingress confidentiality, CSRF, upload size and revocation failures. Successful native BB feature behavior still requires the separately hosted real-core/browser acceptance spike.

## Implemented and verified boundary

`apps/rooms/src/native-access.ts` implements the authenticated native HTTP and WebSocket ingress. `server.ts` selects the actual BB frontend build, validates explicit operators and private upstream configuration, attaches native socket forwarding and closes connections on shutdown. `app.ts` exposes bootstrap, retains independent Rooms identity, and prevents a nonoperator room owner from assigning native context, adding agents, reading private activity, resolving approvals, recovering, stopping or steering execution.

The candidate checkout `/Users/admin/code/Forks/get-bb/bb-native-rooms` in the disposable macOS VM passed Rooms typecheck and three network contract tests. [Evidence](access-evidence/) records:

- Anonymous and collaborator access denied across native project, thread, terminal and plugin paths; an independently authenticated room owner does not become an operator. Forged Connect headers cannot change authority.
- Native HTTP forwards a 70,000-byte binary upload without the room API's 64 KiB limit. Rooms credentials and caller-supplied gate/forwarding headers do not reach the upstream. A plugin cookie remains available. Cookie mutations without a browser origin and requests from an untrusted origin are denied.
- Real notification, terminal and plugin WebSocket upgrades reject guests and hostile origins. Authorized text and binary frames survive both directions. Logout and persisted session expiry close already-open idle sockets.
- Two independently authenticated humans publish with their own server-derived author IDs. Forged authors are rejected. Revoking a guest's membership ends their live SSE subscription and rejects subsequent room messages.

The first red run was a missing new module, not a failed behavioral assertion. A later sensitivity check disabled only periodic socket authorization in the VM, causing the live revocation test to fail while its idle sockets remained open. Restoring the original module byte-for-byte returned the suite to green. The temporary mutation is not part of the candidate source. This guards the specific failure that initial WebSocket authorization alone misses.

This transport result does not yet prove actual BB project/file/terminal/browser workflows or native multi-agent acceptance. Those use the full candidate and are recorded separately. The initial boundary exposed no daemon/enrollment path. That restriction broke adding machines through the gateway; the later machine transport audit addresses it without giving room guests BB execution authority.

## Native resource audit

Source inspection confirmed that native features do not need a second broad proxy namespace:

| Resource | Actual native path | Owner |
| --- | --- | --- |
| Dynamic plugin JavaScript and CSS | `/api/v1/plugin-app-assets/:hash/app.js` and `app.css` | `apps/server/src/services/plugins/app-bundle.ts` |
| Plugin logos and icons | `/api/v1/plugins/:id/assets/*` | `apps/server/src/routes/plugins.ts` |
| Plugin HTTP and WebSocket routes | `/api/v1/plugins/:id/http/*` | `apps/server/src/routes/plugins.ts` |
| File, image, revision, attachment and HTML preview bytes | `/api/v1/projects/*`, `/api/v1/environments/*`, `/api/v1/threads/*`, `/api/v1/hosts/*` | `apps/app/src/lib/file-content-urls.ts` |
| Native browser control | `/api/v1/desktop-browsers/*` | `apps/server/src/routes/desktop-browsers.ts` |
| Notification and terminal sockets | `/ws`, `/ws/terminals/:terminalId` | `apps/server/src/server.ts` |
| OAuth completion UI | `/auth/callback` | `apps/app/src/views/AuthCallbackView.tsx`; client-side SPA route |
| Built frontend modules, fonts and images | `/assets/*` | Actual `apps/app/dist` artifact |

All API resources in that table use the same operator gate; none are routed to the SPA fallback. Built static assets are public implementation artifacts. Missing `/assets/*` must return 404 as the BB core does, rather than sending the index HTML with a successful status. The callback route correctly loads the actual BB index and router. Provider sign-in and account-pool OAuth use their provider/device flow; adding this callback UI route does not prove their credential renewal.

The Connect source also names `x-bb-cloud-dev-host` as a trusted routing header. It belongs in the ingress stripping set alongside all `x-bb-gate-*`, `x-bb-tunnel-*`, `x-bb-relay*`, `x-bb-connect-machine`, forwarded host/protocol and proxy-authorization headers. Plugin-local `x-bb-plugin-token` is a distinct native plugin authorization contract and remains available to the upstream.

The additional header regression failed with the literal attacker-supplied cloud-dev host reaching the controlled upstream. The implementation now strips it, and the complete three-test ingress suite and Rooms typecheck pass again; see `access-clouddev-red.log`, `access-resource-green.log` and `access-resource-typecheck.log` in the evidence directory. The gateway's static route now returns 404 for missing `/assets/*`; that simple route repair still needs the actual candidate resource request in the final browser acceptance run.

The initial resource audit missed machine transport: its Rooms-only `/health` omitted core move metadata, and blocked `/install.*` and `/internal/*` prevented machine enrollment through this origin. The [subsequent audit and repair](machine-transport.md) addresses those exact contracts. Combined BB and Rooms server migration remains explicitly unsupported because BB's archive and launcher do not include the separate Rooms state and service; native check/start move requests return an explanatory 409. This is a known implementation gap, not merely missing test coverage.
