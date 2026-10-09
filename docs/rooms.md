# BB Rooms preview

Rooms puts humans and independent agents in one attributed conversation. Each human has a password-protected identity and joins through a single-use invitation. Each agent owns a persistent BB thread and workspace. Type `@builder`, select multiple agent chips, or choose a default agent for unaddressed prompts. Human mentions address people without starting an agent. Everyone in the room sees incremental replies and tool activity.

This fork adds a companion application in `apps/rooms`, shared schemas in `@bb/domain`, an experimental SDK client, and `bb rooms` commands. It builds on current upstream BB; it does not require the Work Together fork's external MCP/web/worker services. See [the source audit](../specs/research/work-together.md).

## Run

Use Node 24 and the repository-pinned pnpm. Start an isolated BB server and host daemon using the existing development launcher. Keep their operator APIs private; expose only the Rooms gateway.

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@bb/rooms --filter=@bb/cli
ROOMS_DATA_DIR=/absolute/private/rooms-data \
ROOMS_PUBLIC_ORIGIN=https://rooms.example \
ROOMS_BB_URL=http://127.0.0.1:38886 \
node apps/rooms/dist/server.js
```

On first start, the gateway creates Workshop and writes its single-use owner token to `ROOMS_DATA_DIR/owner-invite`, mode 0600. Open `https://rooms.example/#invite=TOKEN` privately to claim it. The fragment is cleared immediately and never sent to the HTTP server. Create a separate invitation in People for each collaborator.

Authenticate agent providers on the execution machine using their supported tools. Claude Code and Codex require their own configured credentials. Pi supports local and cloud models configured in its native `~/.pi/agent/models.json`. For Pi, enter its full `provider/model` identifier in the Add agent form. An installed CLI is not proof of authenticated provider access.

## Working together

- Any member can send, select agents, stop their work, and steer a running agent. Owners add agents, select the default, create invitations, remove members, and resolve provider decisions.
- Multiple selected agents run independently. A busy agent queues later messages; Steer explicitly redirects its active turn.
- An agent can request another agent by placing `[[ask @handle: concrete request]]` on its own line in a final reply. Automatic handoffs stop after two hops.
- Reloading reconstructs the persisted conversation. SSE and a polling fallback update partially generated replies. A proxy that buffers SSE still delivers incremental content through the fallback.
- Membership is checked on every API request and continuously on live connections. Revocation closes room access. Sessions expire after seven days.

## SDK and CLI

```ts
import { createExperimentalRoomsClient } from '@bb/sdk';
const rooms = createExperimentalRoomsClient({ baseUrl: 'https://rooms.example', token });
const snapshot = await rooms.room(roomId);
await rooms.send(roomId, { text: '@builder Review this idea', requestId: crypto.randomUUID(), recipients: [] });
```

The same client is exported from `@bb/sdk/browser` and used by the UI. Named methods cover rooms, invitations, agent creation, sending, stopping and steering. `request(method, path, body)` covers the remaining authenticated gateway routes, including membership, default-agent and provider interactions. Route paths are relative to `/api`.

```sh
bb rooms --server https://rooms.example --token-file /private/session login --credentials-file /private/login.json
bb rooms --server https://rooms.example --token-file /private/session list
bb rooms --server https://rooms.example --token-file /private/session show ROOM
bb rooms --server https://rooms.example --token-file /private/session send ROOM --message-file prompt.txt
bb rooms --server https://rooms.example --token-file /private/session agent-add ROOM --file agent.json
bb rooms --server https://rooms.example --token-file /private/session invite ROOM
bb rooms --server https://rooms.example --token-file /private/session stop ROOM AGENT
bb rooms --server https://rooms.example --token-file /private/session steer ROOM AGENT --message-file prompt.txt
```

The login file contains `handle` and `password`. Login exclusively creates a mode-0600 session file and never prints its token. Delete the credential file after use. JSON command output can contain conversation content; treat it accordingly.

## Boundaries and recovery

This is a preview for people who trust each other with coding-agent access. Agents can execute tools according to their BB provider permissions; Pi requires full permission. Workspaces are separate directories, not security sandboxes. Do not host unrelated tenants or secrets in the same execution VM. HTTP membership controls do not constrain a deliberately hostile agent's filesystem access.

The gateway stores SQLite WAL data separately from BB. Back up both data directories consistently. Running deliveries reconnect to their existing BB threads after a gateway restart. An interrupted dispatch is marked ambiguous and requires inspection before a human resubmits; it is never automatically duplicated. A disconnected BB server produces a visible execution error. Data and stream history are persisted, but the preview UI displays the most recent 300 messages, and prompts include the most recent 80 completed messages within a 32,000-character shared-context budget. Agent count is limited to eight per room.

There is no email/password recovery, organization SSO, per-member execution budget, or OS isolation per room yet. Temporary public tunnels change their hostname when restarted; update the allowed origin and share fresh invitation URLs. Keep the execution server private and route TLS only to the authenticated gateway.

## Verification

```sh
pnpm exec turbo run build typecheck test --filter=@bb/rooms
pnpm exec turbo run build typecheck --filter=@bb/cli
```

Browser acceptance scripts live in `apps/rooms/test`. Run them against the built application in its isolated environment. The human suite exercises two separate browser sessions, concurrent messages, persisted reload and revocation. The real-agent suite requires a configured Pi model and exercises two independently running agents and actual filesystem tools. See the staged verification report for exact executed checks and limitations.
