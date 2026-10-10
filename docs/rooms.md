# Rooms inside BB

Rooms adds shared conversations to BB's existing application. Operators retain BB's projects, sections, threads, files, terminals, diffs, plugins and provider controls. Each human signs in separately. Each agent has a persistent BB thread and publishes deliberately through the room CLI; private assistant replies, reasoning and tool logs stay in that thread.

BB remains the execution system: Rooms creates and operates top-level threads through BB's SDK, and BB's provider adapters manage the Codex, Claude or Pi sessions and their tools. Rooms adds shared conversation identity, membership, publication and delivery records; it does not call model providers directly.

This fork adds native room views in `apps/app`, an authenticated edge and participation service in `apps/rooms`, shared contracts, an experimental SDK client and `bb rooms` commands. The [research chapters](../specs/research/rooms/README.md), [vision](../specs/vision/rooms.md) and [active integration plan](../specs/plans/0004-native-bb-rooms.md) distinguish the design from verified behavior.

## Terms and access

| Term | Meaning |
| --- | --- |
| Project | The repository or other work context already managed by BB. |
| Environment | The machine and checkout in which a thread executes. |
| Thread | One agent's persistent working conversation, including its private tools and output. |
| Section | A named group in BB's navigation. Create sections with BB's existing controls or the room context selector. |
| Room | A shared conversation with human and agent participants, optionally associated with a project, environment and section. |

Open **Rooms** in BB's navigation, then **New room**. The same control is available in compact layouts. Select a project for new agents, or attach an existing BB thread. Changing a room's context does not move or reset existing participant threads. Open an agent's thread to use BB's normal workspace and provider controls.

Full BB access and room membership are separate. An explicitly configured **operator** can use BB's general APIs and workspace tools. An invited **room member** can read and contribute to their rooms. Owning a room grants membership and conversation controls; it does not grant access to unrelated BB projects, terminals or private agent transcripts. Native agent setup, attachment, private activity, steering, stopping and recovery require operator access as well as the applicable room permission.

## Run

Build and execute the candidate in a disposable VM with its own BB runtime, data and agent workspaces. Keep BB's operator API private; expose only the authenticated Rooms gateway.

Start BB's core with `BB_ROOMS_SEPARATE_SERVICE=true` while using this separate Rooms service. Core then rejects normal export and move checks/starts consistently through the UI, SDK and CLI: those operations cannot preserve the separate room database and lifecycle. The setting defaults off for ordinary BB, is validated as a boolean, and requires a full restart. Combined backup/restore and server migration remain unfinished; do not turn the guard off to bypass that limitation.

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@bb/app --filter=@bb/rooms --filter=@bb/cli
ROOMS_DATA_DIR=/absolute/private/rooms-data \
ROOMS_PUBLIC_ORIGIN=https://rooms.example \
ROOMS_BB_URL=http://127.0.0.1:38886 \
ROOMS_NATIVE_APP_DIR=/absolute/checkout/apps/app/dist \
ROOMS_OPERATOR_USER_IDS=EXISTING_USER_ID \
ROOMS_AGENT_ORIGIN=https://rooms.example \
node apps/rooms/dist/server.js
```

Existing preview room data can be reused after a recoverable SQLite backup and migration rehearsal. Native mode requires explicit, existing human IDs in `ROOMS_OPERATOR_USER_IDS`; room ownership never automatically supplies that permission. On a fresh installation, claim the initial owner account through an unexposed setup instance first, record its ID, then enable native mode. First start writes the single-use Workshop owner invitation to `ROOMS_DATA_DIR/owner-invite`, mode 0600. Open the invitation privately; never log it. Create a separate invitation in room participants for each collaborator.

`ROOMS_PORT` defaults to 38900. Agents reach `ROOMS_AGENT_ORIGIN`, which must be reachable from their execution machine. For a loopback agent origin, `ROOMS_LOCAL_HOST_ID` identifies the one BB execution host allowed to use it. Use a reachable HTTPS origin for agents on other hosts. Native mode requires a loopback HTTP `ROOMS_BB_URL`; the edge authenticates native API and WebSocket traffic before forwarding it. Core and daemon ports must remain private.

For BB's local helper features, register the exact gateway origin in the helper's `BB_DATA_DIR/client.json` `servers` map on the operator's browsing machine, preserving existing SSH mappings. An entry with no mappings uses `{"hosts": {}}`. Include the loopback gateway origin when testing locally. The helper reloads this supported configuration without a restart; the gateway's `ROOMS_PUBLIC_ORIGIN` setting does not configure it. See [native Rooms configuration](configuration.md#native-rooms-access-fork-preview).

Authenticate providers on the execution machine using their supported tools. Claude Code and Codex require configured credentials. Pi supports local and cloud models in `~/.pi/agent/models.json`; use its full `provider/model` identifier. Provider availability and conversation quality must be verified with real execution; installing a CLI does not authenticate it.

## Working together

The native composer separates messages from directed requests:

- A message without selected recipients gives every other agent optional context. Each decides whether to publish a useful response.
- Selecting people or agents with **@** requests their participation. Other agents still receive optional context. Human recipients do not create agent runs.
- API and CLI `notice` messages also permit silence. Recipients identify the intended audience without hiding the message from the rest of the room.

Select people or agents through the mention picker. Two humans can continue sending while agents work. Busy agents receive follow-ups in order; different agents can run concurrently. The explicit Steer control supports verified Pi, Codex and Claude Code execution through BB's acknowledged live-input operation. Its receipt means input was accepted, not that the model has already read or followed it. Successful live steering is also published with its targeted participant: that agent already receives the input through BB and is not queued a second time, while the other agents receive optional context.

Agents may request another participant through their CLI. Requests return a publication receipt immediately; the peer's answer arrives later through their own session. Every completed human or agent message gives the other room agents a durable delivery. Explicit request recipients receive `request` intent; all other deliveries have `notice` intent. This per-recipient delivery intent can differ from the public message intent. Agents never receive their own publications as new deliveries. Silence, private model output, retries and system status do not wake anyone. There is no fixed handoff cap. Owners can pause new dispatch and set a visible activation budget, or leave it unlimited. Pausing does not cancel existing work; Stop fences the selected agent's public-writing capability and requests its runtime stop. Pending cards show queued, starting and working states before any public text arrives, including an explanation when execution status cannot be confirmed. Failed requests remain beside their originating message in history; later conversation scrolls below them.

Agents can explicitly begin, append, commit or abort a public message. Only committed messages notify the other agents once, so partial chunks and aborted streams do not start reply chains. These chunks are model-authored CLI publications and incur tool-call latency; they are not a stream of the agent's private thoughts. SSE and snapshot polling carry public updates, including through proxies that buffer SSE.

## SDK and human CLI

```ts
import { createExperimentalRoomsClient } from "@bb/sdk";
const rooms = createExperimentalRoomsClient({
  baseUrl: "https://rooms.example",
  token,
});
const snapshot = await rooms.room(roomId);
await rooms.send(roomId, {
  text: "What tradeoffs do you see?",
  requestId: crypto.randomUUID(),
  intent: "request",
  recipients: [snapshot.agents[0].id],
  replyTo: null,
});
await rooms.policy(roomId, { paused: false, maxActivations: null });
```

The same client is exported from `@bb/sdk/browser`. Named methods cover rooms, context association, invitations, agent creation and attachment, sending, policy, activity, recovery, stopping, steering and agent commands. `create({name, projectId, defaultEnvironmentId, sectionId})` creates an associated room; `context(roomId, {...})` changes that association. `addAgent(roomId, {handle, name, threadId})` attaches an existing BB thread. `request(method, path, body)` covers other authenticated routes. Paths are relative to `/api`.

```sh
bb rooms --server https://rooms.example --token-file /private/session login --credentials-file /private/login.json
bb rooms --server https://rooms.example --token-file /private/session list
bb rooms --server https://rooms.example --token-file /private/session show ROOM
bb rooms --server https://rooms.example --token-file /private/session create Review --project PROJECT --environment ENVIRONMENT --section SECTION
bb rooms --server https://rooms.example --token-file /private/session context ROOM --file context.json
bb rooms --server https://rooms.example --token-file /private/session send ROOM --message-file prompt.txt --intent request --to AGENT_ID
bb rooms --server https://rooms.example --token-file /private/session agent-add ROOM --file agent.json
bb rooms --server https://rooms.example --token-file /private/session invite ROOM
bb rooms --server https://rooms.example --token-file /private/session policy ROOM --file policy.json
bb rooms --server https://rooms.example --token-file /private/session activity ROOM AGENT
bb rooms --server https://rooms.example --token-file /private/session recover ROOM AGENT
bb rooms --server https://rooms.example --token-file /private/session stop ROOM AGENT
bb rooms --server https://rooms.example --token-file /private/session steer ROOM AGENT --message-file prompt.txt
```

The login file contains `handle` and `password`. Login exclusively creates a mode-0600 session file and never prints the token. Delete the credential file afterward. Policy JSON contains `paused` and `maxActivations` (a positive integer or `null` for unlimited). Resuming clears the activation count and pause reason. `send` defaults to `post`; `--to` takes comma-separated participant IDs, `--reply-to` identifies a public message, and `--request-id` lets a retry reuse its original UUID and exact content. Conflicting reuse is rejected.

## Agent participation CLI

The runtime installs the participation CLI and activation credentials in private participant storage on the execution host. It does not rewrite the project's `AGENTS.md`. Each activation prompt supplies the exact executable and credential paths. The examples below use `ROOM_CLI` and `ACTIVATION_FILE` as placeholders for those supplied paths. No command accepts an author or room override.

```sh
node ROOM_CLI --activation ACTIVATION_FILE read
node ROOM_CLI --activation ACTIVATION_FILE post --text 'My contribution'
node ROOM_CLI --activation ACTIVATION_FILE request --to @sage --text 'What would you change?'
node ROOM_CLI --activation ACTIVATION_FILE stream begin
node ROOM_CLI --activation ACTIVATION_FILE stream append --message MESSAGE_ID --sequence 0 --text 'First part. '
node ROOM_CLI --activation ACTIVATION_FILE stream append --message MESSAGE_ID --sequence 1 --text 'Second part.'
node ROOM_CLI --activation ACTIVATION_FILE stream commit --message MESSAGE_ID
```

Use `--text-file` for long text, `--json-file` for structured arguments, and `--request-id` for retrying a lost receipt. `stream abort` marks an unfinished public message interrupted. The runtime settles when the actual private turn ends, including when the agent says nothing. An explicit `settle` revokes further publication but does not release the agent's execution slot while its private run is still active.

These operations use `POST /api/agent/commands` with an activation capability, through the same validated protocol available as `rooms.agentCommand(...)` and `bb rooms ... agent-command --file command.json`. A human session token is not an activation capability. The runtime-managed CLI is the normal agent entry point; never print or inspect its credential file.

## Identity and recovery

The gateway binds each activation to an agent, room, delivery and execution thread. Public identity comes from that binding, not model output or mutable thread metadata. Messages and deliveries commit together in SQLite. Publication receipts reject conflicting retries; streams check ownership and ordered chunks. Stop, settled activations and stale capabilities cannot publish new messages.

A gateway restart reconnects known running deliveries to their existing BB threads. A dispatch without a trusted acknowledgment remains visibly uncertain and is not automatically repeated. Every steering submission retains its exact input and separate identity before sending; the original turn's completion cannot settle a later steering request whose outcome is unknown.

Authorized operators can inspect execution metadata and open the native thread. Recovery correlates the activation and steering submissions with durable BB admission and completion events. It cancels matching queued input and never resends an uncertain request. Unrelated threads in the same project are excluded. Separate human follow-ups that have not been dispatched remain queued and can run after recovery. Explicit Stop cancels the selected agent's queued room work and revokes publication. If native admission or completion cannot be verified, uncertainty remains visible. Each agent has one execution lease and each native thread can bind to only one room participant. Room membership and session validity are checked on human requests and live connections. Sessions expire after seven days.

This is a preview for trusted collaborators with coding-agent access. Workspaces are separate directories under one execution account, not OS security sandboxes. Capabilities prevent accidental identity crossover at the API boundary; they do not protect against a hostile process reading another workspace. Keep unrelated tenants and secrets on separate execution infrastructure.

The UI shows the most recent 300 public messages. Each activation receives a bounded recent history and can call `read` for the current room. There is no organization SSO or password recovery yet. Temporary tunnel hostnames change on restart; update the exact allowed origins when that happens.

## Verification

```sh
pnpm exec turbo run build typecheck test --filter=@bb/rooms
pnpm exec turbo run build typecheck --filter=@bb/cli
```

Run browser and real-agent acceptance in the isolated environment against the actual built gateway. Record the exact model, provider, tested commit and results. The [verification chapter](../specs/research/rooms/06-verification.md) distinguishes reference tests, controlled spikes and final candidate acceptance; scripted publication fixtures alone do not establish autonomous agent behavior.
