# Gas City Slack packs: explicit participation in shared rooms

## What is actually implemented, and which Slack pack is relevant?

### Takeaway

The relevant reference is **slack-full's company-room path**, not “the Slack pack” generically. It explicitly keeps ordinary assistant output private and requires a CLI action to speak. slack-mini and slack-channel drop bot messages and cannot alone implement the desired peer conversation.

### Cited Findings

- Research snapshot, 2026-10-09: gascity-packs main `520e95cb22992a8a1017f7a60da267f203497c7e`, committed 2026-10-08, releasing slack-full 0.0.5. Gas City core snapshot `5de30260d5d7c7f27ce1b7e518209c5508b06467`, committed 2026-10-09T16:57:32Z. All source links below pin these snapshots. — [packs commit](https://github.com/gastownhall/gascity-packs/commit/520e95cb22992a8a1017f7a60da267f203497c7e), [core commit](https://github.com/gastownhall/gascity/commit/5de30260d5d7c7f27ce1b7e518209c5508b06467)
- **slack-mini** is app-mention → one mayor session, explicit `gc slack-mini post-message` outbound. It drops messages with bot ID or any subtype. — [README](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-mini/README.md#L1-L26), [filter](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-mini/adapter/main.go#L405-L460)
- **slack-channel** binds human channel messages to multiple sessions, supports a leading textual handle alias, and explicit publish/reply/react commands. Bindings and aliases are additive: alias targeting does not suppress the other bound recipients. All bot/system/edited messages are rejected. Thus multiple agents independently receive human messages but cannot wake one another using their Slack replies. — [routing](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-channel/adapter/inbound.go#L54-L128)
- slack-channel identities are **cosmetic username/avatar overrides on one bot**, not independent Slack bot principals. The outbound code applies `Username`, `IconURL`, `IconEmoji`; the README requires `chat:write.customize`. — [identity implementation](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-channel/adapter/outbound.go#L51-L96)
- **slack-full company rooms**, merged July 25 in PR233, add a switchboard admission owner, actual per-agent identity apps, independently bound named sessions, peer requests/results, DMs/mpim and recovery. This is shipped source, although the design document still calls itself Draft v2. — [merged PR233](https://github.com/gastownhall/gascity-packs/pull/233), [topology](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/docs/company-rooms.md#L31-L73)
- The decisive agent contract says **plain assistant output stays private**, human-visible output requires `gc slack reply-current --turn-ref ... --body-file ...`, the JSON receipt must confirm posting, and agents should not prepend their own names because authenticated authorship handles attribution. — [actual prompt fragment](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/template-fragments/slack-v0.template.md#L49-L72)
- The named agent and its transient runtime session are distinct concepts. A directory names agents and room membership; separate bindings map exactly one `(room, agent)` to a session, optionally in another city. This is not a parent spawning children whose final prose is concatenated. — [bindings contract](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/docs/company-rooms.md#L104-L160)

### Inferences

- A BB implementation should preserve an agent principal across provider sessions/restarts and authenticate room publication as that principal. A model printing “Reviewer:” must never produce a Reviewer-authored message.
- The private runtime transcript is a debugging surface, not the shared conversation event log. A wrapper should never infer a public post from final assistant text, ordinary progress text, or a prose marker.
- Use slack-full as a source of protocol invariants, not as a drop-in model for unrestricted debate: its formal delegation and normal reply semantics deliberately constrain peer continuation.

### Gaps

- No live Slack workspace was used in this investigation. Author/routing/receipt behavior was source-inspected; deterministic upstream fixture tests were subsequently run in the disposable VM, documented below.
- Source inspection found post-message publication, not token-stream APIs (`chat.startStream`, `chat.appendStream`, `chat.stopStream`) or an explicit streaming message update protocol in the reviewed outbound surfaces. Therefore “Slack packs prove live token streaming” is not a supported conclusion.

## How do notification, activation, explicit posting and termination work?

### Takeaway

Receiving context is not an obligation to reply, and a public post does not implicitly activate every other agent. slack-full makes those distinctions through wake kinds, explicit trusted addressing, private assistant output and server-side result correlation. It also imposes a one-hop formal delegation rule; BB should not silently adopt that semantic cap.

### Cited Findings

- Company rooms distinguish `ambient`, `thread_ambient`, `targeted`, `peer_delegation`, `peer_result`, `peer_input`, `dm`, `mpim`. Ambient turns and peer-input turns may be read without posting. Targeted human messages request a response. Membership alone is not activation. — [wake/response contract](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/template-fragments/slack-v0.template.md#L9-L47)
- This contract is inserted in each authenticated inbound reminder, not merely left in an optional setup prompt. `peer_input` says respond only when useful; ambient says do not acknowledge generically or repeat another agent; immutable routing data appears outside the untrusted message body. — [rendered per-turn contract](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_hydration.go#L440-L494)
- Human native mentions are exclusive: only the mentioned eligible members wake, suppressing ambient wake. Untagged human messages wake configured ambient readers. Trusted company-bot messages only wake explicitly mentioned eligible peers, excluding themselves; bot messages without mentions and unknown bots produce no wake. — [routing implementation](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_routing.go#L267-L364)
- An agent's authenticated earlier participation in a thread enrolls it for later **untagged human** follow-ups. This is not automatic ambient delivery of all agent messages. Membership is revalidated, later/future participation does not affect an earlier redrive, and native mentions remain exclusive. — [thread ambient implementation](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_thread_ambient.go#L28-L89)
- Peer admission checks registered author, distinct receiver, native structured mention, both members, receiver eligible, and one bound receiver session. A string naming an agent is not identity or authority. — [peer trust checks](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_peer.go#L60-L106)
- Formal delegation is an explicit `gc slack delegate` action. It emits a visible request as the delegator's real bot identity and records the expected responder. Results return as the responder, mention only the requester and correlate via durable delegation record + metadata nonce. — [delegate implementation](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/scripts/slack_company_outbound.py#L1894-L1996), [result publication](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/scripts/slack_company_outbound.py#L2209-L2263)
- **Actual one-hop restriction:** `run_delegate` refuses every peer-derived turn (`peer_delegation`, `peer_input`, `peer_result`) and permits only human-rooted ambient/thread-ambient/targeted turns. All sibling delegations must be issued before waiting. It rejects self-targeting and at most one outstanding request per requester/responder/thread tuple. This is an application policy, not a consequence of the ability to chat. — [enforcement](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/scripts/slack_company_outbound.py#L1912-L1972), [regression](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/tests/test_slack_company_synthesis.py#L405-L441)
- Ordinary company replies for ambient/targeted/peer_input are escaped and contain **no live mentions**. Synthesis similarly avoids waking agents. Thus the standard tool path intentionally comes to rest rather than enabling arbitrary ping-pong debate. — [ordinary reply](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/scripts/slack_company_outbound.py#L2368-L2399), [synthesis](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/scripts/slack_company_outbound.py#L2350-L2364)
- Core separates runtime delivery intent: `default`, `follow_up` (queue until turn boundary), `interrupt_now` (interrupt and replace). Capabilities are provider-dependent, and submission reports queued versus delivered. Per-session mutation locking protects concurrent submissions. — [core Submit API](https://github.com/gastownhall/gascity/blob/5de30260d5d7c7f27ce1b7e518209c5508b06467/internal/session/submit.go#L34-L162)

### Inferences

**Proposed BB default, not claimed existing behavior:**

1. A room post is a durable communication record authored by one authenticated human/agent principal. Visibility does not mean activation.
2. Each agent has a durable inbox/cursor. Every permitted post is readable; only explicit recipients or opted-in topic/thread subscriptions schedule evaluation. Incoming `notice` means “context, reply optional”; incoming `ask` means “please address this request.” Asking does not delegate human privileges.
3. `room.post` publishes; `room.notify` schedules context evaluation; `room.ask` creates a correlated request; `room.delegate` creates an optional tracked work obligation with authority explicitly bounded. These may be one API with a typed `intent` field, but must not be conflated.
4. A mention should be a participant ID selected by the UI/tool, not a regular expression over arbitrary output. Quoted mentions remain ordinary text. Agent-authored posts default to no activation unless they deliberately address another participant or an enabled discussion subscription applies.
5. Agents can finish an evaluation with zero posts. Record `activation.settle(outcome=no_reply|replied|waiting|error)` internally for the status UI; never synthesize “I have nothing to add” into the public room. Runtime completion can settle the activation if the provider supports reliable terminal events; an explicit finish tool gives auditability but needs validation against runtime completion.
6. Natural debate can use an explicitly started discussion with participants and purpose. Participants receive peers' final public posts as optional-response notifications, do not receive their own echo as a wake, and may explicitly ask another participant to continue. Idle/no-post is normal. Stop when all activations settle and no eligible inbox items remain. Human messages can wake the discussion again. Do not silently cut off at two or one handoffs.
7. Explicit tools alone do **not** mathematically guarantee termination: eager agents can choose to keep asking. Use visible, adjustable time/token/spend/activation budgets, rate/cycle detection and a Stop conversation control as operational guardrails. Do not impose a hidden number of semantic exchanges. Distinguish “conversation idle,” “waiting for peer,” and “budget paused.”
8. For busy input, persist human input first and show accepted/queued/seen states. Deliver at provider-safe boundaries using declared capabilities; do not pretend every provider accepts streaming mid-tool interruption. Human urgent steering/stop must be distinct from ordinary follow-up/context.

### Gaps

- This source does not establish an unrestricted, self-terminating many-agent debate algorithm. In particular, copying its one-hop formal workflow would reproduce a limitation the user rejected.
- A room notification may trigger an evaluation with no visible post, but that still incurs a model turn. No source evidence proves a model can perceive every event while asleep without running.
- No verified universal in-flight delivery across all providers; core explicitly has capability and provider differences.

## What reliability, identity, recovery and validation should BB adopt?

### Takeaway

Use a canonical room event log plus durable per-recipient deliveries and explicitly authenticated publication, with immutable activation routing and retry semantics. Do not equate transport acceptance with delivery, reading, posting or task completion. The upstream tests offer strong deterministic reference seams, but are not live multi-human/model validation.

### Cited Findings

- Company ingress persists before acknowledging Slack, keyed by canonical `(team, channel, timestamp)` origin. Receipt creation is first-writer-wins atomic; updates use generation checks; admitted contents survive restart and duplicates. — [receipt store implementation](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/ingress_receipts.go#L22-L83)
- Delivery persists an immutable per-activation `turn_ref` before submission. It binds receipt, city, session, agent and wake kind; record creation is durable and refuses conflicting identity/routing data. Thus another room's message cannot overwrite a shared session's destination. — [turn records](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_turn.go#L22-L146), [cross-room race test](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/tests/test_slack_chat_reply_current.py#L929-L1005)
- The adapter submits **all** target agents before waiting for results, avoiding one slow agent blocking dispatch to its peers. It persists asynchronous request ID/event cursor and reconnects to the event stream after that cursor; HTTP202 alone is not marked delivered. — [dispatch](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_delivery.go#L1006-L1098), [correlation stream](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_async_delivery.go#L179-L249), [all-targets test](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_async_delivery_test.go#L222-L279)
- Formal delegation/result/synthesis outbound paths use durable intents and reconcile unknown Slack post outcomes rather than blindly reposting. The ordinary root-reply function, however, directly calls `post_message` and has no durable intent, despite the broad design prose. This is an observed implementation limitation, not something BB should inherit. — [delegate intent](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/scripts/slack_company_outbound.py#L1962-L1996), [ordinary reply direct post](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/scripts/slack_company_outbound.py#L2368-L2399)
- Visible acknowledgement uses receipt-stage reactions, which are explicitly best effort; the durable receipt remains authoritative. A delivered check means delivery, not proof that the model answered correctly or completed its work. — [ack implementation](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_acks.go#L8-L15), [ack lifecycle](https://github.com/gastownhall/gascity-packs/blob/520e95cb22992a8a1017f7a60da267f203497c7e/slack-full/adapter/company_acks.go#L106-L153)
- Remaining work in upstream is not all merged: PR484 (open Oct9) repairs post/upload lookup after a durable named seat changes session IDs; PR338 (open) proposes burst coalescing, per-audience parent dedupe, once-per-channel instructions and delivery policies; PR213 (open) proposes reliability for legacy ack-first ingress plus echo guards for user-token bot signatures. These are authored proposals/claims, not guarantees of current main. — [PR484](https://github.com/gastownhall/gascity-packs/pull/484), [PR338](https://github.com/gastownhall/gascity-packs/pull/338), [PR213](https://github.com/gastownhall/gascity-packs/pull/213)
- Gas City core likewise has open proposed fixes for sleeping room deliveries and publication lookup (PR6840), connected-client SSE/reply (PR3657), and request/reply correlation fields (PR6667). Do not mistake their presence for shipped capability. — [PR6840](https://github.com/gastownhall/gascity/pull/6840), [PR3657](https://github.com/gastownhall/gascity/pull/3657), [PR6667](https://github.com/gastownhall/gascity/pull/6667)

### Inferences

Proposed acceptance scenarios for BB's replacement (these are requirements, not tests executed against BB):

- Two humans and two independent agents join the same room. Human A asks both; both have distinct principals, runtimes, tool credentials and public receipts. Human B can speak while either is busy.
- Agent A emits private prose including “B says: …” without calling the publication tool. Room gets zero messages. A calls room.post; one A-authored message appears. Attempting authorId=B is rejected by server-side capability, not a prompt instruction.
- Agent A posts an ordinary update. Everyone can read it, but zero other agent activations are created unless explicitly subscribed/addressed. A never wakes itself from the room echo.
- B receives an optional notice, decides nothing useful remains and settles no_reply. No public placeholder reply, retry, or follow-up is generated. Conversation becomes idle.
- An opted-in debate exceeds two exchanges, then naturally becomes idle when agents stop posting. A human follow-up resumes it. Operational budget exhaustion produces a visible paused state with reason and Resume/Stop controls, never a fabricated final answer.
- Agent A works on Room1 activation while Room2 wakes it. The Room1 publication capability still routes only Room1. Stale/wrong agent/session/activation capabilities fail. Test against concurrent tool requests.
- Duplicate human requests, duplicate delivery events and retried post tools create one canonical message and one delivery per intended agent. Simulate crash after persist/before dispatch, after dispatch/before receipt, and after publication/before client response. Recover idempotently and retain original authorship.
- Acquire a per-agent execution lease with fencing epoch; two schedulers cannot run the same agent activation concurrently. Different agents run concurrently. Expired workers cannot publish after replacement.
- Streaming is explicit publication: begin message, ordered append/replace revisions, finish/abort under one author/activation capability. The room sees incremental public content, but no peer wakes on every chunk; notify once on final publication (unless an explicitly selected collaboration mode allows otherwise). Private reasoning/tool logs remain private.
- No auto-conversion of peer request to human authority. Human permissions and membership survive across model runtime restarts and remain checked at every read/post.

Deterministic upstream test seams for the VM reference spike:

- Go adapter `TestComputeWakeSet*`: ambient vs targeted, no unmentioned bot wake, self/unknown rejection.
- `TestCompanyThreadParticipant*`: authenticated prior participation and restart reconstruction, exclusive mentions.
- `TestAcceptance3*`, `TestAcceptance5*`: independent peer authors, requests/results, clarifications and replay.
- `TestIngressReceipt*`, `TestCompanyCrash*`, `TestCompanyRetry*`, `TestCompanyStoreFailure*`, `TestCompanySaturation*`: dedupe, crash windows, first-writer concurrency, durable retry and backpressure.
- `TestCompanyAsync*`: accepted vs delivered, independent fanout, event cursor/reconnect, no repost after disconnect.
- Python `test_slack_chat_reply_current.py`: immutable turn_ref routing while a second room changes the session's current pointer; cross-session/tampered-route rejection.
- Python `test_slack_company_synthesis.py`: explicit one-hop enforcement and result readiness; proves this limitation exists, not that BB should adopt it.

### Gaps

- Reference tests use fake Slack/GC HTTP endpoints and fixtures. They exercise real pack code but do not demonstrate live models understanding no-reply, live Slack auth, or BB's final protocol.
- Generic idempotency keys do not give global exactly-once semantics by themselves. The authoritative BB broker can make canonical message creation exactly-once per key transactionally; external provider tool effects remain separately recoverable/ambiguous.
- No implementation was merged, deployed or changed in the user's live Workshop during this research/spike. Source snapshot and toolchain/test evidence are under `specs/research/spikes/gascity-reference`; execution occurred only in `/Users/admin/gascity-participation-spike` in the existing disposable Rooms VM.

Reference spike completed 2026-10-09T17:08:17Z: **46 top-level Go tests (55 pass events including subtests) passed with -race; 88 Python tests passed**. Go package elapsed 4.791s, Python0.22s. Go1.25.9 was downloaded from go.dev and SHA256 verified, installed only in scratch; pytest9.1.1 used a scratch Python3.14.7 virtualenv. Full exact commands, logs, source archive, JUnit and machine-readable result saved in [reference spike evidence](../../spikes/gascity-reference/README.md). These are executed reference fixtures with fake Slack/GC HTTP endpoints, not a live-model or final-BB verification.
