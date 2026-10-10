# Native Rooms UI review

The source review covered the native authentication boundary, room navigation, context forms, pending requests, message publication and the shared room index. Execution stayed in the disposable macOS VM. The coordinator ran the tests against the candidate checkout; no stable BB runtime was used.

## Repairs

- **Saved context:** an uncontrolled environment selector mounted before its asynchronous options arrived. Submitting unrelated room controls could silently replace the saved environment with `null`. Project, environment and section selections now retain their saved IDs while options load. An explicit project change clears the environment selection.
- **Recovered transport:** room transport failures and action failures shared one error state. Successful snapshots now clear transport errors, action failures remain visible, and switching rooms clears both. A late action failure from the previous room cannot appear in the new room.
- **Pending input:** a running room delivery could remain labelled “Working” while its native BB thread awaited an approval or answer. Operator room owners now poll the existing private interaction endpoint and see “Awaiting input” with a link to the actual thread. Only interaction status is retained for display; private prompts and tool details are not rendered into room history. Resolving the interaction restores the working label.
- **Draft preservation:** completing a send previously cleared whatever text was in the composer, including text typed later or a new room's draft. Completion now checks both the room generation and the submitted draft before clearing it. Navigating to a new room also releases that room's send control independently of the old request.
- **Native controls:** room icons use the registered shared icon names. The account drawer remains available before entering a room, including accounts with no rooms, so sign-out does not depend on an active room.
- **Identity changes:** the UI owner repaired the session gate to clear cached queries, disconnect native sockets and remount the authenticated subtree when either the user ID or role changes. This covers guest-to-guest and operator-to-operator changes as well as logout and demotion.

## Evidence

Six new DOM regression cases exercise the production room components through actual form values, controlled HTTP responses and server-event delivery. They cover saved context, transport/action error lifecycle, pending input and resolution, absence of guest private-interaction requests, and delayed send completion in the same room and another room.

Before the repairs, the context test observed `null` instead of the saved environment ID. The room-view run recorded four intended failures: recovered error still visible, missing awaiting-input state, and lost new drafts in both navigation cases. The guest suppression case already passed. The room-view red run is recorded at `/Users/admin/rooms-native-qa/view-red.log` in the disposable VM.

After the repairs, the coordinator reported all six new cases passing as part of a 45-test targeted app run covering Rooms UI, authentication, context, route integration and navigation ordering. The session suite includes eight cases, including separate guest and operator identity-switch cases. These DOM tests use controlled network and event boundaries; they do not prove a provider's actual approval round trip or replace browser acceptance of the built candidate.

## Scope and remaining qualification

The existing Rooms interaction endpoint requires both room ownership and an explicit BB operator grant. Guests and non-owner operators therefore continue to see public room delivery state; this change does not expand the private API contract. A future public pending-input signal should expose only generic state and preserve private thread details.

The resource audit found native plugin assets, previews, files and browser APIs under the existing `/api/v1` operator proxy, and notification/terminal/plugin sockets under the covered WebSocket routes. No additional broad proxy namespace was needed. Native enrollment and server-move interfaces remain intentionally unavailable at the collaborator ingress. Provider sign-in renewal and arbitrary third-party OAuth callbacks still require their own qualification.
