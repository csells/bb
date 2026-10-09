# Participants publish while runtimes execute privately

This chapter specifies the proposed replacement, not verified current behavior. Its central invariant is that **only an explicit authenticated publication command creates a public agent message**. A human or agent is a stable room participant. An agent's BB session is its private execution environment. Public conversation, private model activity and scheduler deliveries have separate records and permissions. The design draws from [Buzz's explicit CLI publication](02-buzz.md), [Gas City's immutable turn routing](03-gascity.md) and [Work Together's trusted tool identity](04-work-together-bb.md).

## Bind authority before the model runs

Each human authenticates separately. Each named agent has a distinct principal, membership and private runtime binding. The server creates a revocable activation capability bound to agent, room, triggering delivery, provider session and fencing epoch. The model cannot choose its author or move that capability into another room by changing arguments. Per-room roles govern membership and posting; permission to run shell tools or access repositories is a separate execution policy. A peer request never inherits the original human's broader authority.

The CLI and native/MCP tools should wrap the same validated protocol. The first candidate implements `read`, `post`, `request`, `stream.begin/append/commit/abort` and `settle`; runtime admission reconciliation owns acknowledgment rather than requiring a separate agent `ack`. Public input contains text, recipient IDs, intent and reply target; identity comes from authentication. Publication receipts contain the canonical message and its accepted recipients. Bindings must be held by trusted server state, not mutable model-visible metadata.

## Publication does not always start an agent

A visible post is readable by room members without obligating every agent to run. Targeted asks schedule the named eligible participants. Optional notices and opt-in discussion subscriptions permit evaluation without a reply. Self-authored echoes, replay duplicates and stream revisions do not schedule new work. A request for another agent's contribution creates a real recipient delivery; writing that agent's name in prose does not.

Durable message acceptance and recipient outbox creation should be atomic. Per-agent inboxes persist unread/accepted/queued/dispatched/settled state. Independent agents can run concurrently, while one provider session serializes its own active execution. Human follow-ups arriving during work are accepted immediately, then queued or steered according to provider capability and explicit user intent. A steering request leaves the durable queue only after a recognized delivery acknowledgment.

A peer request is asynchronous. Its command returns a publication receipt, not the peer's answer. The requesting agent can finish its current contributions and private turn; a later reply addressed to it creates a new delivery. Repeating the request after a successful receipt does not wait for or accelerate that answer. Current delivery and historical context must be distinguished explicitly so agents do not re-execute old requests. The natural candidate spike exposed why this contract belongs in both the CLI guidance and activation instructions: a real agent repeated successful requests within one activation, creating new messages rather than transport retries.

An activation can settle as replied, no-reply, waiting, canceled or failed. **No-reply is successful silence** and does not synthesize a public acknowledgment. A discussion becomes idle when there is no active work and no eligible delivery. New human input can resume it. There is no hidden two-handoff limit. Visible operational budgets and a conversation Stop/Pause control prevent unintended runaway activity; hitting a budget produces an explicit paused reason rather than silently dropping messages.

## Streaming is an explicit public-message lifecycle

`stream.begin` deliberately selects a public destination and returns one message ID. Authenticated ordered chunks update that message; retries are idempotent. `commit` finalizes it and notifies recipients once. `abort` marks it interrupted and prevents stale later writes. Reconnection recovers the latest message revision and subsequent events. Private provider commentary, tool logs and reasoning never become fallback room text.

This requires two distinct proofs. A scripted begin/append/commit test proves the gateway protocol. **Actual model-generated public streaming** additionally needs a provider adapter that selects the public operation before forwarding its incremental content, potentially using streamed tool arguments. Repeated explicit append calls are another option but incur model/tool round trips. Neither a private activity stream nor three prewritten chunks proves the intended model behavior.

## Recovery must fence obsolete workers

Command idempotency keys identify one canonical public mutation across lost responses and retries. A durable activation lease and fencing epoch reject output from canceled, revoked or replaced workers. Restart recovers delivery cursors and pending publication state without automatically replaying external tool effects. An accepted room message, delivered model input, observed public response and completed user task are four different facts; UI and tests must preserve those distinctions.

The first candidate chooses an activation-specific CLI capability and durable external leases. Public streaming uses explicit append calls. Native/MCP adapters and stronger OS isolation remain future work; the preview documents its trusted-collaborator boundary. Natural model behavior, streaming, and integrated lifecycle verification remain gates in [the spike plan](../../plans/0001-rooms-participation-spikes.md).
