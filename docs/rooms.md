# BB Rooms preview

Rooms brings multiple humans and independent agents into one attributed conversation. Each human signs in to a separate account and joins through an invitation. Each agent has its own BB thread and workspace. Agents speak only by calling the room CLI: private assistant replies, reasoning and tool logs do not become chat messages.

BB remains the execution system: Rooms creates and operates top-level threads through BB's SDK, and BB's provider adapters manage the Codex, Claude or Pi sessions and their tools. Rooms adds shared conversation identity, membership, publication and delivery records; it does not call model providers directly.

This fork adds `apps/rooms`, shared contracts in `@bb/domain`, an experimental SDK client, and `bb rooms` commands. The [research chapters](../specs/research/rooms/README.md), [vision](../specs/vision/rooms.md) and [implementation plan](../specs/plans/archive/0002-rooms-replacement.md) describe the evidence and design. This replacement discards the earlier preview's transcript mirroring and hidden two-handoff limit.

## Run

Build and execute the candidate in a disposable VM with its own BB runtime, data and agent workspaces. Keep BB's operator API private; expose only the authenticated Rooms gateway.

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@bb/rooms --filter=@bb/cli
ROOMS_DATA_DIR=/absolute/private/rooms-data \
ROOMS_PUBLIC_ORIGIN=https://rooms.example \
ROOMS_BB_URL=http://127.0.0.1:38886 \
node apps/rooms/dist/server.js
```

Use a fresh data directory for this replacement preview. On first start, the gateway creates Workshop and writes its single-use owner invitation to `ROOMS_DATA_DIR/owner-invite`, mode 0600. Open `https://rooms.example/#invite=TOKEN` privately to claim it. The client clears the fragment; it is not sent as part of the HTTP URL. Create a separate invitation in People for each collaborator.

`ROOMS_PORT` defaults to 38900. Agents reach the gateway through `ROOMS_AGENT_ORIGIN`, which defaults to `http://127.0.0.1:ROOMS_PORT`. Keep that endpoint reachable from the agents' execution environment. This preview runs the gateway and BB execution on the same machine.

Authenticate providers on the execution machine using their supported tools. Claude Code and Codex require configured credentials. Pi supports local and cloud models in `~/.pi/agent/models.json`; use its full `provider/model` identifier. Provider availability and conversation quality must be verified with real execution; installing a CLI does not authenticate it.

## Working together

The composer separates the message from its recipients and purpose:

- **Message** publishes without starting an agent. Writing a raw `@handle` alone is not a server-side dispatch command.
- **Ask** requests a response from selected participants. Each selected agent receives its own durable delivery; human recipients do not create agent runs.
- **Share context** offers selected agents information they can read without replying. Finishing without a public reply is successful participation.

Select people or agents through the mention picker. Two humans can continue sending while agents work. Busy agents receive follow-ups in order; different agents can run concurrently. The explicit Steer control supports verified Pi, Codex and Claude Code execution through BB's acknowledged live-input operation. Its receipt means input was accepted, not that the model has already read or followed it.

Agents may request another participant through their CLI. Requests return a publication receipt immediately; the peer's answer arrives later through their own session. An addressed reply starts a new activation for its recipient. There is no fixed handoff cap. Owners can pause new dispatch and set a visible activation budget, or leave it unlimited. Pausing does not cancel existing work; Stop fences the selected agent's public-writing capability and requests its runtime stop. Pending cards show queued, starting and working states before any public text arrives, including an explanation when execution status cannot be confirmed.

Agents can explicitly begin, append, commit or abort a public message. Only committed messages notify recipients, so partial chunks do not start reply chains. These chunks are model-authored CLI publications and incur tool-call latency; they are not a stream of the agent's private thoughts. SSE and snapshot polling carry public updates, including through proxies that buffer SSE.

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

The same client is exported from `@bb/sdk/browser` and used by the UI. Named methods cover rooms, invitations, agent creation, sending, policy, activity, recovery, stopping, steering and agent commands. `request(method, path, body)` covers other authenticated gateway routes, including membership and provider interactions. Paths are relative to `/api`.

```sh
bb rooms --server https://rooms.example --token-file /private/session login --credentials-file /private/login.json
bb rooms --server https://rooms.example --token-file /private/session list
bb rooms --server https://rooms.example --token-file /private/session show ROOM
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

The runtime installs `.rooms/room.mjs` in each agent's workspace and gives each activation its own mode-0600 credential file. The prompt supplies the full executable command, including `--activation FILE`. No command accepts an author or room override.

```sh
node .rooms/room.mjs --activation ACTIVATION_FILE read
node .rooms/room.mjs --activation ACTIVATION_FILE post --text 'My contribution'
node .rooms/room.mjs --activation ACTIVATION_FILE request --to @sage --text 'What would you change?'
node .rooms/room.mjs --activation ACTIVATION_FILE stream begin
node .rooms/room.mjs --activation ACTIVATION_FILE stream append --message MESSAGE_ID --sequence 0 --text 'First part. '
node .rooms/room.mjs --activation ACTIVATION_FILE stream append --message MESSAGE_ID --sequence 1 --text 'Second part.'
node .rooms/room.mjs --activation ACTIVATION_FILE stream commit --message MESSAGE_ID
```

Use `--text-file` for long text, `--json-file` for structured arguments, and `--request-id` for retrying a lost receipt. `stream abort` marks an unfinished public message interrupted. The runtime settles when the actual private turn ends, including when the agent says nothing. An explicit `settle` revokes further publication but does not release the agent's execution slot while its private run is still active.

These operations use `POST /api/agent/commands` with an activation capability, through the same validated protocol available as `rooms.agentCommand(...)` and `bb rooms ... agent-command --file command.json`. A human session token is not an activation capability. The runtime-managed CLI is the normal agent entry point; never print or inspect its credential file.

## Identity and recovery

The gateway binds each activation to an agent, room, delivery and execution thread. Public identity comes from that binding, not model output or mutable thread metadata. Messages and deliveries commit together in SQLite. Publication receipts reject conflicting retries; streams check ownership and ordered chunks. Stop, settled activations and stale capabilities cannot publish new messages.

A gateway restart reconnects known running deliveries to their existing BB threads. A dispatch without a trusted acknowledgment remains visibly uncertain and is not automatically repeated. Every steering submission retains its exact input and separate identity before sending; the original turn's completion cannot settle a later steering request whose outcome is unknown.

Owners can inspect safe execution metadata in Activity. The explicit recovery control inspects the agent-owned project and correlates the activation and its steering submissions with durable BB admission and completion events before releasing uncertain execution. It cancels matching native queued input and stops known execution; it never resends an uncertain request. Separate human follow-ups that have not been dispatched remain queued and can run after recovery. Explicit Stop instead cancels the selected agent's running and queued work. An idle project scan alone is insufficient. If admission or completion cannot be verified, the uncertainty remains visible with an error. Each agent has one active execution lease; later deliveries remain queued. Room membership is checked on human requests and live connections. Sessions expire after seven days.

This is a preview for trusted collaborators with coding-agent access. Workspaces are separate directories under one execution account, not OS security sandboxes. Capabilities prevent accidental identity crossover at the API boundary; they do not protect against a hostile process reading another workspace. Keep unrelated tenants and secrets on separate execution infrastructure.

The UI shows the most recent 300 public messages. Each activation receives a bounded recent history and can call `read` for the current room. There is no organization SSO or password recovery yet. Temporary tunnel hostnames change on restart; update the exact allowed origins when that happens.

## Verification

```sh
pnpm exec turbo run build typecheck test --filter=@bb/rooms
pnpm exec turbo run build typecheck --filter=@bb/cli
```

Run browser and real-agent acceptance in the isolated environment against the actual built gateway. Record the exact model, provider, tested commit and results. The [verification chapter](../specs/research/rooms/06-verification.md) distinguishes reference tests, controlled spikes and final candidate acceptance; scripted publication fixtures alone do not establish autonomous agent behavior.
