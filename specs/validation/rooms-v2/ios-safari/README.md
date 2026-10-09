# Actual iOS Safari verification — 2026-10-09

**Passed:** Xcode 27.0, iPhone 17 Pro Simulator, iOS 27.0, real `com.apple.mobilesafari`, one XCUITest with zero failures in 13.161 seconds. This is actual Simulator Safari, not a Chromium viewport or Playwright WebKit claim.

The test opened People twice, opened Add agent, typed into Name with the software keyboard displayed, closed the drawer, typed into the room composer, and submitted a fixture message. It also asserted that the app root never became `inert` or `aria-hidden`, content appeared after the drawer placeholder, the same drawer DOM node survived reopenings, and the page did not overflow horizontally. See [test log](xcodebuild.log), [DOM observations](safari-dom-audit.json), [submitted message](safari-messages.json), and [attachment manifest](attachments/manifest.json).

[Agent drawer with software keyboard](attachments/BE4FD365-5A37-47ED-94F8-3F23DA3C86D6.png) demonstrates the close button remains visible while typing. [Composer after closing](attachments/662B2A84-5F21-4BFF-9285-BC47333BD522.png) shows the successful follow-on action.

## Failures found and fixed

The original built client failed when focusing the 14px Name input: Safari zoomed the page, creating horizontal overflow and moving Close outside the viewport. After adopting the shared BB mobile typography scale with a 16px root/input size, a second failure exposed the custom drawer's `92dvh` height override: it omitted the shared keyboard inset and moved the title above the visible area. The final CSS subtracts `--bb-drawer-keyboard-inset`, keeps the drawer title sticky, and provides a 44px close target. The same interaction test then passed without weakening its assertions.

One intermediate attempt failed before loading the page because the temporary fixture was not ready. The harness now checks HTTP readiness. Failed UI tests caused this Xcode version to restart its runner and then linger after recording the failure; those completed failed runs were terminated explicitly. They are not counted as successful runs.

## Exact scope and artifacts

The original candidate JavaScript remained unchanged throughout. The targeted fixes were tested by replacing its CSS asset contents with the **complete candidate CSS source**, not by rebuilding the monorepo in the temporary Xcode guest. Main imports only `style.css`, and that stylesheet has no external imports; no dependency stylesheet was discarded. Successful test hashes:

| Asset | SHA-256 |
| --- | --- |
| JavaScript `index-CK8m9DxF.js` | `1a67921ae265ffb420b9ac7d746107614b921c9e32775fe929cc88ec89ddc48f` |
| Full candidate source CSS served at `index-BGaTXJTl.css` | `1e6ce4ff84ba2c64587c96ecf83cf97e9508376c7bd74a06df56bbaa2ef03627` |

Final Turbo-built/minified CSS subsequently **passed** the dedicated Chromium and WebKit computed-font and drawer checks in `pending.browser.ts`: both mobile fields compute to 16px and drawer/root/composer usability passed. See [final UI evidence](../ui/README.md). A later unrelated `.pending-error` color rule does not change this Safari drawer finding. This fixture uses synthetic room HTTP responses and DOM instrumentation; it does not establish real authentication, agent scheduling, or model/tool reliability. Those have separate suites.

The full source, xcresult, successful screenshots, and preceding failed traces are retained outside the deleted guest in `/Users/csells/.bb/thread-storage/thr_hgth8j3mzz/rooms-safari-verification/safari-evidence.tgz` (2,307 verified entries), SHA-256 `d9cf68bda86c508049085aa26893e40f00c67be002bc3e1800e10f491fc1c3ab`.

## Isolation and cleanup

The original disposable Rooms VM was gracefully stopped before the temporary Xcode clone started. The test guest had its own OS, Simulator, fixture process and data, with no host directory mounts or application credentials. After verified evidence export, the temporary guest was stopped/deleted and the original Rooms VM resumed at its existing address. Its core health endpoint, host daemon, gateway and replacement public tunnel were checked. Templates and stable BB/Buzz installations remained unchanged; the registry records the temporary guest's removal.
