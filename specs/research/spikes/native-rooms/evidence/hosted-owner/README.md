# Hosted owner verification

The final Chromium probe ran inside the disposable macOS VM against
`https://diary-butler-leone-heavy.trycloudflare.com` on 2026-10-10. It signed in
with the existing owner's password and confirmed that `csells` has explicit
operator access to the native BB application.

The preserved Workshop opened in BB's actual navigation. Its original Atlas and
Nova participant links retained their existing native thread IDs. The probe
opened Atlas's thread and verified its existing `AUTHENTICATION_OK` response.
It then returned to Workshop, waited for the native sidebar to load, opened the
Create room drawer, and verified the room-name field, populated BB project
catalog, and New section control. No rooms, sections, messages, or provider
requests were created by this probe. No browser page errors occurred.

`evidence.json` and the three screenshots are from the successful final run
(`hosted-owner-final-6`). Workshop's screenshots contain preserved historical
failed deliveries and error badges; this read-only navigation check does not
assert a new provider turn succeeded. Separate dialogue verification covers
live agent participation.

The earlier probe failure is retained under `driver-failure/`: it incorrectly
looked for an exact label of `Name`, whereas the product's field is `Room name`.
Only the probe selectors and screenshot readiness waits changed. No product
source or runtime changes were required.

The browser logged out and closed. The private VM login fixture
`preview-owner-private.json` was removed after the successful run, and its
absence was verified. These artifacts contain no password or bearer token.
