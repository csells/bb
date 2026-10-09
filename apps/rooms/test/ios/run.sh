#!/bin/bash
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
suite_root=$(cd "$(dirname "$0")" && pwd)
web_root=${1:?Path to the exact built dist/web required}
evidence_root=${2:?Fresh absolute evidence directory required}
mkdir -p "$evidence_root"
cd "$suite_root"
python3 fixture.py --web "$web_root" --evidence "$evidence_root" > "$evidence_root/fixture.log" 2>&1 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT
for attempt in {1..50}; do
  if curl --max-time 2 -fsS http://127.0.0.1:38901/test/evidence >/dev/null; then break; fi
  sleep 0.2
done
curl --max-time 2 -fsS http://127.0.0.1:38901/test/evidence >/dev/null
xcodegen generate
simulator_id=$(xcrun simctl create RoomsSafariAcceptance com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
printf '%s\n' "$simulator_id" > "$evidence_root/simulator-id"
xcrun simctl bootstatus "$simulator_id" -b
xcrun simctl openurl "$simulator_id" http://127.0.0.1:38901
xcodebuild test -project RoomsSafari.xcodeproj -scheme RoomsSafari -destination "platform=iOS Simulator,id=$simulator_id" -derivedDataPath "$evidence_root/derived" -resultBundlePath "$evidence_root/rooms-safari.xcresult" -parallel-testing-enabled NO > "$evidence_root/xcodebuild.log" 2>&1
xcrun simctl io "$simulator_id" screenshot "$evidence_root/safari-final.png"
xcrun xcresulttool export attachments --path "$evidence_root/rooms-safari.xcresult" --output-path "$evidence_root/attachments"
xcrun simctl shutdown "$simulator_id"
printf 'Safari XCUITest passed; evidence: %s\n' "$evidence_root"
