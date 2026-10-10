#!/bin/bash
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
cd "$(dirname "$0")"
output="${ROOMS_IOS_OUTPUT:-/Users/admin/rooms-native-qa/ios-safari-evidence}"
mkdir -p "$output"
export ROOMS_IOS_OUTPUT="$output"
node proxy.mjs > "$output/proxy.log" 2>&1 &
proxy_pid=$!
simulator_id=""
cleanup() {
  kill "$proxy_pid" 2>/dev/null || true
  if [[ -n "$simulator_id" ]]; then xcrun simctl shutdown "$simulator_id" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
xcodegen generate > "$output/xcodegen.log" 2>&1
simulator_id="${ROOMS_IOS_SIMULATOR_ID:-}"
if [[ -z "$simulator_id" ]]; then simulator_id=$(xcrun simctl create NativeRoomsSafariAcceptance com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0); fi
printf '%s\n' "$simulator_id" > "$output/simulator-id"
xcrun simctl boot "$simulator_id" 2> "$output/boot-request.log" || xcrun simctl list devices booted | grep -F "$simulator_id" > /dev/null
xcrun simctl bootstatus "$simulator_id" -b > "$output/boot.log" 2>&1
xcrun simctl launch "$simulator_id" com.apple.mobilesafari > "$output/safari-launch.log" 2>&1
xcode_args=(test)
if [[ -n "${ROOMS_IOS_ONLY_TEST:-}" ]]; then xcode_args+=("-only-testing:$ROOMS_IOS_ONLY_TEST"); fi
xcodebuild "${xcode_args[@]}" -project NativeRoomsSafari.xcodeproj -scheme NativeRoomsSafari -destination "platform=iOS Simulator,id=$simulator_id" -derivedDataPath "${ROOMS_IOS_DERIVED:-$output/derived}" -resultBundlePath "$output/native-rooms-safari.xcresult" -parallel-testing-enabled NO -collect-test-diagnostics never > "$output/xcodebuild.log" 2>&1
xcrun xcresulttool export attachments --path "$output/native-rooms-safari.xcresult" --output-path "$output/attachments" > "$output/attachments.log" 2>&1
xcrun xcresulttool get test-results summary --path "$output/native-rooms-safari.xcresult" > "$output/test-summary.json"
printf 'Actual iOS Safari verification passed: %s\n' "$output"
