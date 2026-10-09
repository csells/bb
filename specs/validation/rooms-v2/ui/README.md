# Browser evidence — 2026-10-09

The final Turbo-built/minified candidate passed the expanded UI fixture in **both Chromium and WebKit** after the Safari fixes: temporary execution-status failures remain visibly pending, recover cleanly, and are not concealed by a public stream. At a coarse-pointer 390px viewport, composer and agent input compute to **16px**; People and Agent drawers preserve app-root and composer usability. See `final-pending-chromium/test.log` and `final-pending-webkit/test.log`.

The final public HTTPS human suite also passed all eight groups against the resumed staging gateway. See `final-human-browser.log` and `final-human/` screenshots. Final exact client hashes are in [final-client-sha256.txt](final-client-sha256.txt). The earlier evidence below is retained for chronology; the `final-*` files supersede its UI build claims. Natural model/tool participation remains a separate qualification.

All execution occurred inside the disposable Rooms VM. No stable BB or Buzz runtime was used. Main candidate state was `/Users/admin/rooms-v2-data`; owner bootstrap was left unused. Browser contexts and QA accounts were fresh.

- **Real human HTTPS acceptance passed** using `apps/rooms/test/browser.ts` against the candidate's public HTTPS endpoint: separate registration/invitation sessions, distinct authors, concurrent exact-once sends, durable reload, anonymous and forged-author rejection, live membership revocation, desktop and 390px layouts, no JavaScript exceptions. See `human-browser.log`, `humans-desktop.png`, `humans-mobile.png`. The 390px image is Chromium emulation, not iOS Safari.
- **Pending UI fixture passed in Chromium and Playwright WebKit 27.2** using `pending.browser.ts`: queued/starting/working before publication, elapsed time, writable composer, selected public streaming bubble, pending between outputs, stop/error/completion/no-reply clearing, reload and compact layout. See both `pending-*` directories. These synthetic API snapshots test presentation, not authentication, dispatch, model silence, or actual provider token streaming.
- Natural two-human/two-agent publication qualification is **pending**, covered by a separate harness. Actual iOS Simulator Safari subsequently found and verified two CSS fixes; see [its separate report](../ios-safari/README.md). Do not infer model success from these UI results.

The corrected pending fixture aligns agent status with delivery status. An initial rerun against a temporary static server encountered a Chromium navigation timeout before loading the app; rerunning against the real HTTPS endpoint passed. A first human screenshot captured the close animation; the retained run explicitly waits until the drawer is offscreen before capture.

Historical client files from the earlier run (final hashes are linked above):

| File | SHA-256 |
| --- | --- |
| `index.html` | `ff2342b533fe59023caf36e55b5ae96a0f0b2a32779ae9a1bec628161bd6afd0` |
| `assets/index-BGaTXJTl.css` | `971c8d904be9dc961f222d08c7c8ba4aaf677ec542e091067be05af58d6343c2` |
| `assets/index-BIdTtrly.js` | `f079a3397243f60edbf62ec6cae7ac068e9728e1251f8a6d26487fdc51dbb73d` |
