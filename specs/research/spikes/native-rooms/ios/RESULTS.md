# Actual iOS Safari results

The tooling and all application execution run inside the existing disposable
macOS task VM. Xcode 27.0 (27A266a), iOS 27.0 (24A434), and XcodeGen 2.46.0 were
installed there from a verified archive/runtime transfer. The stable source host
only read and transferred toolkit files. Transfer copies were removed after
verified installation.

The first two attempts stopped during initial simulator/Safari startup: iOS
reported boot completion before Safari accepted `simctl openurl`. A subsequent
runner started successfully but Safari retained its initial loading state. The
same proxy served complete HTML with matching byte length and identity encoding;
re-navigation after startup loaded the full application, assets, plugins, and
native APIs. These setup attempts provide no product acceptance evidence. The
harness now explicitly navigates through Safari’s address field.

The first product run (`ios-safari-run4`) demonstrated a real compact-layout
failure. It opened the create-room drawer, typed a room name with the actual iOS
keyboard, and closed/reopened the drawer repeatedly while preserving that draft.
The app root stayed accessible and horizontal width stayed within the viewport.
The scenario then opened the new-section input and typed a section name, but the
Add section action remained below the clipped drawer and keyboard. The expected
section POST never occurred and the XCTest assertion failed.

The screenshot and source explain the failure: the shared drawer applies a
maximum height that shrinks for the keyboard, while the Rooms-specific content
wrapper lacked a shrinking, vertically scrolling area. Its children extended
below the white drawer surface. The UI owner added `min-h-0 overflow-y-auto` to the Rooms-specific content
wrapper, enabling constrained internal scrolling without changing the shared
drawer behavior.

Preserved evidence lives in `../evidence/ios-red/`: Xcode test log, test summary,
DOM observations, keyboard-overflow screenshot, and XCTest attachments. There
are no passwords or bearer tokens in these artifacts; the loopback proxy adds
authentication only to upstream requests.


The focused drawer rerun (`ios-safari-run5`) passed: 118 DOM observations,
first realization after two frames/32ms, one persistent create-drawer node,
maximum internal scroll of 393 pixels, contained vertical content, and no root
accessibility or horizontal overflow violations. Native section creation returned
201 and room creation returned 200. Reopening the create form showed an empty
name, and the participants drawer opened and closed successfully.

Independent screenshot/database review caught an overly broad final message
assertion in that run: XCTest matched the still-populated composer's static text,
while the room had no stored message. The drawer result remains valid; it is not
message-publication acceptance. The harness now requires the composer to clear. A focused injected-newline
probe inserted a line break, rather than requesting publication; no Enter-to-send
claim is made for that automation path. The final focused check uses the native
Done control to dismiss the keyboard and then taps Send.


The final focused publication check (`ios-composer-run7`) passed in 16.9 seconds.
It opened/closed participants, entered a message, dismissed the keyboard, tapped
Send, and required the composer to clear before matching the history message.
The captured message POST returned 200. A separate read-only SQLite inspection
confirmed exactly one stored human message in the new QA room. The final
screenshot shows that message in history and an empty composer.

Final evidence is in `../evidence/ios-composer-green/`, including the test summary,
DOM/API audit, database persistence report, and `published-message.png`. The
successful drawer evidence remains in `../evidence/ios-green/`; its initial
message assertion is explicitly marked insufficient, with this focused result
supplying publication proof. The unsuccessful newline probe is retained in
`../evidence/ios-composer-initial/`.

Both task-owned simulators were shut down and deleted. The loopback proxy was
stopped and its temporary 38920 helper origin removed, preserving the existing
38910 configuration. Installed guest tooling remains available until VM teardown.
No production service, host runtime, or source workspace was used for candidate
execution. The iOS tests used only the separate QA core/gateway and their own
room/section.

Xcode emitted Apple's duplicate `UIAccessibilityLoaderWebShared` diagnostic from
the iOS runtime's WebKit/WebCore accessibility bundles. The final result bundle
reports no runtime warnings or test failures. No Apple runtime files were changed;
the original diagnostic remains in the exported Xcode logs for toolkit follow-up.
