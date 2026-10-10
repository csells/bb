# Actual iOS Simulator Safari verification

This harness executes the built candidate in Safari on an iPhone 17 Pro iOS 27
Simulator inside the disposable task VM. It does not run any candidate or
simulator process on the stable source host.

`run.sh` uses the candidate gateway on guest loopback port 38910 and starts a
loopback-only proxy on 38920. The proxy reads the existing QA operator token from
its private file and attaches it upstream. Neither XCTest typing logs, arguments,
artifacts, nor browser JavaScript contain credentials. Login itself is covered by
the separate native browser acceptance, while this scenario covers actual iOS
Safari input, keyboard, persistent drawers, and room/section creation.

The proxy forwards the actual HTML, assets, streaming responses, native APIs, and
WebSockets. It injects a DOM observer script, which records root accessibility,
drawer node identity, placeholder/realization frame timing, and viewport sizes.
It does not replace product APIs, markup, or UI behavior. The QA host helper must
allow the exact proxy origin `http://127.0.0.1:38920`, just as it allows the gateway
origin during regular staged browser testing.

The captured focused composer test uses the QA room ID created by the drawer
run. When repeating this spike with a fresh QA database, update that fixture ID
from the new room result before running the focused method. The source and
evidence preserve the exact task fixture used for this verification.

The scenario opens and closes the create drawer repeatedly, confirms the draft
survives, creates a native section and a room, reopens an empty create form,
opens/closes the participants drawer, and sends a real persisted human message.
It checks that the app root never receives inert/aria-hidden, the same drawer
node remains until navigation, content realization waits for two animation
frames or the 120ms fallback, and the page never overflows horizontally.

Run only inside the task VM after toolkit/runtime installation and after other
heavy browser/build activity has finished:

```sh
bash specs/research/spikes/native-rooms/ios/run.sh
```

Evidence is written under `/Users/admin/rooms-native-qa/ios-safari-evidence`.
Preserve sanitized audit JSON, screenshots, test summary, and Xcode logs outside
the VM. The result bundle and DerivedData can remain in the disposable VM until
teardown. The harness shuts down only its own simulator on exit. Delete that
simulator by its recorded ID after evidence is exported.


The accepted outcome combines the full drawer/section/room run and the stricter
focused Send check; see [RESULTS.md](RESULTS.md). The latter dismisses the native
keyboard with Done before tapping Send, waits for the composer to clear, and
checks database persistence independently. Injecting a newline through XCTest is
not evidence for keyboard Enter-to-send behavior.

To run one focused method against the existing QA fixture, set
`ROOMS_IOS_ONLY_TEST=NativeRoomsSafariUITests/NativeRoomsSafariTests/testComposerPublishesAfterDrawer`.
Use a fresh `ROOMS_IOS_OUTPUT` directory for each attempt. Set
`ROOMS_IOS_SIMULATOR_ID` only to a retained task-owned device; otherwise the harness
creates one. `ROOMS_IOS_DERIVED` can reuse the prior task-owned build directory.
