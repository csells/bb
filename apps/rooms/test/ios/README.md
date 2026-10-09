# Actual iOS Safari drawer verification

This is a browser compatibility fixture, not an authentication, scheduler, or model acceptance test. It serves the exact candidate `dist/web` with synthetic room HTTP responses and injects a DOM observer for root usability, deferred content, persistent drawer identity, overflow, and keyboard visibility. XCUITest drives the **Safari app in iPhone 17 Pro / iOS 27 Simulator**, opening People repeatedly, editing an agent field with the keyboard up, closing the drawer, then publishing through the composer. Actual API/model behavior is covered by the separate participation browser and runtime suites.

## Isolated execution procedure

1. Finish and export the main Rooms VM tests. Copy its exact built `apps/rooms/dist/web` and this directory to a credential-free archive outside that VM. Record the archive SHA-256.
2. Coordinate with the root agent; gracefully stop only the disposable Rooms VM. Confirm no other Tart guest is running and verify live memory/disk. Preserve its disk, private state, service registration, and the original stopped Xcode template.
3. Clone the registry's `orca-automation-xcode-template` to a unique task guest. Start using the registered `vm.py` helper with no host directory shares. Discover its address, pin SSH to the verified inherited template key, and verify guest identity/Xcode/Simulator versions.
4. Transfer the archive into `/Users/admin/rooms-safari-check`. Do not transfer service credentials, BB core runtime, or private Rooms data. Run inside that disposable guest:

   ```sh
   bash /Users/admin/rooms-safari-check/ios/run.sh \
     /Users/admin/rooms-safari-check/web \
     /Users/admin/rooms-safari-evidence
   ```

5. Inspect `xcodebuild.log`, `rooms-safari.xcresult`, attachments, DOM audit and published fixture message. A failed selector or first-run Safari screen is a test failure to diagnose; do not label it a pass based only on a screenshot. Preserve failures and rerun after evidence-based fixes.
6. Export evidence before graceful shutdown and deletion of only the temporary Safari guest. Resume the original Rooms VM using its existing launcher, rediscover its address, verify gateway/core readiness and public URL, and update the service record if the VM address changed.

The VM templates, launch/access helpers, reservation rules, and registered addresses belong in the home-lab registry. Read the current `machine-orca` record before running; these instructions intentionally do not hardcode the temporary guest address.
