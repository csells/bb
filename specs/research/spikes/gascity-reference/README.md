# Gas City reference protocol spike

Executed 2026-10-09 in the existing disposable Rooms VM, separate scratch `/Users/admin/gascity-participation-spike`. The live Workshop service, its state, credentials and shared Ollama configuration were untouched. No Slack message or model request was sent. These are reference implementation fixtures, not end-to-end BB tests.

## Results

- **46 top-level Go tests passed** (55 pass events including subtests), with race detection, no failures. Package run 4.791 seconds, excluding initial toolchain download/build.
- **88 Python tests passed**, 0.22 seconds.
- Go 1.25.9 darwin/arm64; Python 3.14.7; pytest 9.1.1.
- Source gascity-packs commit `520e95cb22992a8a1017f7a60da267f203497c7e` (2026-10-08). Source archive included for reproducibility.
- Missing toolchains were installed only under scratch: official go1.25.9 darwin/arm64 archive verified against go.dev release SHA256 `9528be7329b9770631a6bd09ca2f3a73ed7332bec01d87435e75e92d8f130363`; pytest installed in a task-specific Python virtual environment. No system toolchain replaced. Initial shell URL-globbing error was corrected before download and any test execution.

## Commands

From `slack-full/adapter`, with scratch GOPATH/GOCACHE and GOTOOLCHAIN=local:

```sh
GOMAXPROCS=1 go test -json -race -p=1 ./... \
  -run 'Test(ComputeWakeSet|CompanyThreadParticipant|CompanyThreadParticipants|Acceptance3|Acceptance5|IngressReceipt|CompanyAsync|CompanyCrash|CompanyRetry|CompanyStoreFailure|CompanySaturation)' \
  -count=1
```

From `slack-full`, using scratch virtualenv:

```sh
python -m pytest tests/test_slack_company_synthesis.py \
  tests/test_slack_chat_reply_current.py -q --junitxml=python-junit.xml
```

## What the spike establishes

The real pack functions pass fixtures for human ambient versus exclusive targeted activation, no ambient bot echo, authenticated agent participation, distinct peer request/result routing, one-hop delegation enforcement, result readiness, immutable turn routing when another room wakes the same session, receipt deduplication/concurrent admission/crash recovery, all-recipient submission before waiting, async acceptance versus delivery, and reconnect without duplicate submission.

The private-output/public-CLI boundary was source-inspected; these fixture tests do not run an LLM or demonstrate that a given model obeys no-reply instructions. A real-model acceptance test is still required for the replacement.

## Evidence

- `result.json`: exact commands, versions, counts and scope.
- `go-test.jsonl`, `go-test.stderr`: full test event stream and toolchain stderr.
- `python-test.log`, `python-junit.xml`: Python output and cases.
- `go-download.json`: official artifact metadata/hash used.
- `slack-full-source-520e95c.tar.gz`: tested upstream source; not a deployed service.

Tests intentionally did not contact the existing Slack workspace, exercise provider credentials, run the entire Gas City core, or change the Rooms preview. Runtime/provider handling of busy input, authenticated BB room tools and public streaming remain separate BB integration spikes.
