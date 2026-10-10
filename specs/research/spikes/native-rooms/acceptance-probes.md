# Native room acceptance probes

Run these only inside the reserved disposable VM, from the candidate checkout, after the coordinator releases the VM test slot. Neither probe calls a provider directly.

## Migration rehearsal

`rehearse-migration.ts` opens the existing preview database read-only and uses SQLite's online backup API. It opens only the resulting isolated copy for migration. It imports the real database migration entry point without importing RoomsStore or RoomRuntime, so no dispatcher can replay copied work.

```sh
node --conditions=source --import tsx specs/research/spikes/native-rooms/rehearse-migration.ts \
  /Users/admin/rooms-v2-data/rooms.sqlite \
  /Users/admin/rooms-native-qa \
  /Users/admin/rooms-native-qa/migration-rehearsal.sqlite \
  specs/research/spikes/native-rooms/evidence/migration-rehearsal.json
```

The destination and evidence file must not exist. Every old column of every `rooms_*` table is compared before and after migration using deterministic whole-row digests. This includes passwords, sessions, invites, membership, publication and steering receipts, delivery states, and native thread bindings. Reports expose counts, digests and non-secret identities; credential values and password hashes are never printed. The new context and credential-location fields must all remain null. Integrity and foreign-key checks must pass, and the actual hash of migration 0145 must appear once in the ledger.

Keep the copied database private in the disposable data directory. Only the redacted evidence JSON is suitable for exporting to the source checkout. Delete the private copy at VM teardown.

## Real BB bindings

`prove-bindings.ts` uses the fresh candidate core on port 38896 and an operator session on the candidate native Rooms gateway. It requires a mode-0600 file containing only that session token; never put the token on the command line. The host's reported execution storage must be inside `/Users/admin/rooms-native-qa/`.

```sh
node --conditions=source --import tsx specs/research/spikes/native-rooms/prove-bindings.ts \
  http://127.0.0.1:38896 CANDIDATE_GATEWAY_URL PRIVATE_TOKEN_FILE CANDIDATE_HOST_ID \
  /Users/admin/rooms-native-qa/bindings-acceptance \
  specs/research/spikes/native-rooms/evidence/real-bindings.json
```

The probe creates its own project, workspace, section, room and threads. It first finishes a native Codex turn, then attaches the existing thread. Attaching must preserve its exact thread/project/environment identity, execution settings, existing event history and `AGENTS.md` bytes, without a new provider turn. Duplicate binding must fail.

It adds new Codex and Claude participants to that same project/environment, asks each for an independent public contribution, and waits for their private turns and optional peer deliveries to finish. Both must publish through the supplied room CLI under distinct participant IDs. The project list and `AGENTS.md` must remain unchanged.

Finally, it pauses only its own room and starts unrelated native work on the attached thread. Cancelling a queued room request must leave that native turn active. A scoped BB Stop naming an already-completed turn must also leave it active; a Stop naming the actual successor must complete that successor. The fixture room is left paused and identifiable for inspection.

The script records progress and proof in its evidence file. A failed assertion means that acceptance remains incomplete; a partially written report is not a passing result. A failure can leave identifiable QA work running, which the coordinator must inspect and stop through the candidate BB API before reusing the fixture. Do not blindly re-run over existing fixtures or alter the current preview to obtain a pass.

## Preserved preview after replacement

`compare-preserved-rooms.py` accepts the pre-cutover Rooms backup, post-cutover Rooms database, pre-cutover BB core backup, post-cutover BB core database, expected Workshop ID and output evidence path. It opens all four databases read-only and never starts a runtime.

Run it immediately after migration and before new provider acceptance prompts. Every existing room-table row must retain all of its old columns, including authentication and publication receipts. Additional sessions or identities are allowed; additional public history, deliveries, activations or publication receipts are rejected at this point as possible replay. For every existing native binding, it also compares prior thread configuration, project defaults, environment identity/path and all historical BB events. Thread status and read/activity timestamps can change during restart; native identity and configuration cannot. New native turn requests or starts before new user activity fail the check.

```sh
python3 specs/research/spikes/native-rooms/compare-preserved-rooms.py \
  ROOMS_BACKUP ROOMS_DATABASE BB_CORE_BACKUP BB_CORE_DATABASE \
  606b2f3e-4501-45f4-a4fd-83bae65f447a \
  specs/research/spikes/native-rooms/evidence/preview-preservation.json
```
