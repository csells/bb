import {
  userQuestionPendingInteractionPayloadSchema,
  pendingInteractionPayloadSchema,
  isApprovalPendingInteractionPayload,
  type PendingInteractionPayload,
  type ApprovalPendingInteractionPayload,
  type ApprovalInteractionOutcome,
  roomsActivitySchema as activitySchema,
} from "@bb/domain";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import { z } from "zod";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import {
  snapshotSchema,
  type Snapshot,
  type User,
  type Room,
  type Agent,
} from "./contracts.js";
import "./style.css";
import { createExperimentalRoomsClient } from "@bb/sdk/browser";
const roomsClient = createExperimentalRoomsClient({ baseUrl: location.origin });
async function api<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
): Promise<T> {
  return (await roomsClient.request(method, path, body)) as T;
}
const invitation =
  new URLSearchParams(location.hash.slice(1)).get("invite") ?? "";
if (invitation) history.replaceState(null, "", location.pathname);
function ApprovalControls({
  payload,
  submit,
}: {
  payload: ApprovalPendingInteractionPayload;
  submit: (body: ApprovalInteractionOutcome["resolution"]) => Promise<void>;
}) {
  return payload.availableDecisions.map((decision) => (
    <button
      key={decision}
      onClick={() =>
        void submit(
          decision === "deny"
            ? { decision }
            : {
                decision,
                grantedPermissions:
                  payload.subject.kind === "permission_grant"
                    ? payload.subject.permissions
                    : decision === "allow_for_session" &&
                        (payload.subject.kind === "command" ||
                          payload.subject.kind === "file_change")
                      ? payload.subject.sessionGrant
                      : null,
              },
        )
      }
    >
      {decision === "allow_once"
        ? "Allow once"
        : decision === "allow_for_session"
          ? "Allow for session"
          : "Deny"}
    </button>
  ));
}
function Avatar({ name, agent = false }: { name: string; agent?: boolean }) {
  return (
    <span className={"avatar " + (agent ? "silicon" : "human")}>
      {agent ? "✳" : name.slice(0, 2).toUpperCase()}
    </span>
  );
}
function PendingReplies({
  snapshot,
  decisionAgents,
}: {
  snapshot: Snapshot;
  decisionAgents: string[];
}) {
  const deliveries = snapshot.deliveries.filter((d) =>
    ["queued", "dispatching", "running", "uncertain"].includes(d.state),
  );
  const [now, setNow] = useState(Date.now);
  const hasWork = deliveries.length > 0;
  useEffect(() => {
    if (!hasWork) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasWork]);
  return deliveries.map((delivery) => {
    const agent = snapshot.agents.find((a) => a.id === delivery.agentId);
    if (!agent) return null;
    const output = snapshot.messages.filter(
      (m) => m.authorId === agent.id && m.causeId === delivery.messageId,
    );
    const latest = output.at(-1);
    const needsDecision = decisionAgents.includes(agent.id);
    const uncertain = delivery.state === "uncertain";
    if (
      !uncertain &&
      !needsDecision &&
      !delivery.error &&
      latest?.kind === "agent" &&
      latest.status === "streaming" &&
      latest.text.trim()
    )
      return null;
    const cause = snapshot.messages.find((m) => m.id === delivery.messageId);
    const since = delivery.startedAt ?? delivery.createdAt ?? cause?.createdAt;
    const elapsed =
      since === undefined
        ? null
        : Math.max(0, Math.floor((now - since) / 1000));
    const state = uncertain
      ? `${agent.name} needs attention`
      : delivery.error
        ? `Checking ${agent.name}’s status`
        : needsDecision
          ? `${agent.name} needs a decision`
          : delivery.state === "queued"
            ? `Queued for ${agent.name}`
            : delivery.state === "dispatching"
              ? `Starting ${agent.name}`
              : output.length
                ? `${agent.name} is working`
                : cause?.intent === "notice"
                  ? `${agent.name} is considering your message`
                  : `${agent.name} is working on your request`;
    return (
      <div
        className={`message pending-reply${uncertain ? " attention-reply" : ""}`}
        key={delivery.id}
        data-agent-id={agent.id}
      >
        <Avatar name={agent.name} agent />
        <div className="message-body">
          <div className="pending-heading">
            <span className="pending-status" role="status">
              {!uncertain && <i className="pulse" aria-hidden="true" />}
              {state}
            </span>
            {!uncertain && elapsed !== null && (
              <span className="pending-elapsed" aria-label="Elapsed time">
                {elapsed < 60
                  ? `${elapsed}s`
                  : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
              </span>
            )}
          </div>
          {delivery.error && (
            <p className="pending-error" role="alert">
              {uncertain
                ? "Execution could not be confirmed. This request has not been retried. "
                : "Unable to confirm execution status. Your request remains pending. "}
              {delivery.error}
            </p>
          )}
          <p>
            {uncertain
              ? "The room owner can inspect Activity and resolve this interruption. Accepted follow-ups remain queued."
              : needsDecision
                ? "Review the request below to continue."
                : snapshot.room.paused && delivery.state === "queued"
                  ? "Agents are paused. Your message is saved."
                  : "You can keep typing. Only messages the agent chooses to share appear here."}
          </p>
        </div>
      </div>
    );
  });
}
function QuestionForm({
  payload,
  submit,
}: {
  payload: unknown;
  submit: (body: unknown) => Promise<void>;
}) {
  const parsed = userQuestionPendingInteractionPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const questions = parsed.data.questions;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const answers = Object.fromEntries(
          questions.map((q) => {
            const freeText = String(form.get(q.id + ":text") ?? "").trim();
            return [
              q.id,
              {
                selected: form.getAll(q.id).map(String),
                ...(freeText ? { freeText } : {}),
              },
            ];
          }),
        );
        void submit({ kind: "user_answer", answers });
      }}
    >
      {questions.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.prompt}</legend>
          {q.options?.map((o) => (
            <label key={o.value}>
              <input
                type={q.multiSelect ? "checkbox" : "radio"}
                name={q.id}
                value={o.value}
              />
              {o.label}
              {o.description && <small>{o.description}</small>}
            </label>
          ))}
          {q.allowFreeText && (
            <label>
              Your answer
              <textarea name={q.id + ":text"} maxLength={4096} />
            </label>
          )}
        </fieldset>
      ))}
      <button type="submit">Send answers</button>
    </form>
  );
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [rooms, setRooms] = useState<Room[]>([]),
    [roomId, setRoomId] = useState(localStorage.getItem("bb-room") ?? ""),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [connected, setConnected] = useState(false),
    [text, setText] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [panel, setPanel] = useState<
      "agent" | "invite" | "room" | "settings" | "activity" | null
    >(null),
    [inviteUrl, setInviteUrl] = useState(""),
    [sending, setSending] = useState(false),
    [steering, setSteering] = useState<Agent | null>(null),
    [inputStatus, setInputStatus] = useState("");
  const [realizedPanel, setRealizedPanel] = useState<
    "agent" | "invite" | "room" | "settings" | "activity"
  >("invite");
  useEffect(() => {
    if (panel) setRealizedPanel(panel);
  }, [panel]);
  const [activityAgentId, setActivityAgentId] = useState("");
  const [budgetDraft, setBudgetDraft] = useState("");
  function openRoomControls() {
    setBudgetDraft(snapshot?.room.maxActivations?.toString() ?? "");
    setPanel("settings");
  }
  const [activity, setActivity] = useState<z.infer<
    typeof activitySchema
  > | null>(null);
  const [activityError, setActivityError] = useState("");
  const [intent, setIntent] = useState<"post" | "request" | "notice">("post");
  const [invitePending, setInvitePending] = useState(Boolean(invitation));
  const [authMode, setAuthMode] = useState(invitation ? "register" : "login");
  const [mention, setMention] = useState<string | null>(null);
  const [pending, setPending] = useState<
    {
      agent: Agent;
      id: string;
      payload: PendingInteractionPayload;
    }[]
  >([]);
  const end = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    follow = useRef(true);
  const publicationAttempt = useRef<{
    signature: string;
    requestId: string;
  } | null>(null);
  async function refresh() {
    const data = await api<{ user: User; rooms: Room[] }>("/me");
    setUser(data.user);
    setRooms(data.rooms);
    setRoomId((prev) =>
      data.rooms.some((r) => r.id === prev) ? prev : (data.rooms[0]?.id ?? ""),
    );
  }
  useEffect(() => {
    refresh()
      .catch((e) => {
        if (!String(e).includes("Sign in")) setError(String(e));
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!user || !roomId) {
      setSnapshot(null);
      setConnected(false);
      return;
    }
    localStorage.setItem("bb-room", roomId);
    setSnapshot(null);
    setSelected([]);
    setIntent("post");
    setSteering(null);
    setInputStatus("");
    setInviteUrl("");
    setPanel(null);
    publicationAttempt.current = null;
    follow.current = true;
    const es = new EventSource(`/api/rooms/${roomId}/events`);
    es.addEventListener("snapshot", (event) => {
      try {
        setSnapshot(snapshotSchema.parse(JSON.parse(event.data)));
        setConnected(true);
      } catch (e) {
        setError(String(e));
      }
    });
    es.addEventListener("access-error", (event) => {
      setError(JSON.parse(event.data).error);
      setConnected(false);
      es.close();
      void refresh();
    });
    let active = true;
    const poll = async () => {
      try {
        const next = snapshotSchema.parse(await api(`/rooms/${roomId}/poll`));
        if (active) {
          setSnapshot((prev) =>
            prev?.room.revision === next.room.revision &&
            JSON.stringify(prev.online) === JSON.stringify(next.online)
              ? prev
              : next,
          );
          setConnected(true);
        }
      } catch (e) {
        if (active) {
          setConnected(false);
          if (
            String(e).includes("not a member") ||
            String(e).includes("Sign in")
          ) {
            setError(String(e));
            es.close();
            void refresh();
          }
        }
      } finally {
        if (active) timer = setTimeout(poll, 1000);
      }
    };
    let timer: ReturnType<typeof setTimeout>;
    void poll();
    es.onerror = () => setConnected(false);
    return () => {
      active = false;
      clearTimeout(timer);
      es.close();
    };
  }, [user?.id, roomId]);
  useEffect(() => {
    if (follow.current) end.current?.scrollIntoView({ behavior: "instant" });
  }, [snapshot?.room.revision]);
  useEffect(() => {
    if (!snapshot || snapshot.room.ownerId !== user?.id) {
      setPending([]);
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const groups = await Promise.all(
          snapshot.agents
            .filter((a) => a.threadId)
            .map(async (agent) => {
              const response = z
                .array(
                  z.object({
                    id: z.string(),
                    payload: pendingInteractionPayloadSchema,
                  }),
                )
                .parse(
                  await api<unknown>(
                    `/rooms/${roomId}/agents/${agent.id}/interactions`,
                  ),
                );
              return response.map((item) => ({ ...item, agent }));
            }),
        );
        if (active) setPending(groups.flat());
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [snapshot?.agents.map((a) => a.threadId).join(","), roomId]);
  useEffect(() => {
    setActivity(null);
    setActivityError("");
    if (
      panel !== "activity" ||
      !activityAgentId ||
      snapshot?.room.ownerId !== user?.id
    )
      return;
    let active = true;
    const refreshActivity = async () => {
      try {
        const value = activitySchema.parse(
          await api(`/rooms/${roomId}/agents/${activityAgentId}/activity`),
        );
        if (active) {
          setActivity(value);
          setActivityError("");
        }
      } catch (error) {
        if (active)
          setActivityError(
            error instanceof Error ? error.message : String(error),
          );
      }
    };
    void refreshActivity();
    const timer = setInterval(refreshActivity, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [panel, activityAgentId, roomId, snapshot?.room.ownerId, user?.id]);
  async function run(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await run(async () => {
      await api(
        "/auth/" + authMode,
        authMode === "register" ? { ...values, invite: invitation } : values,
      );
      if (authMode === "register") setInvitePending(false);
      await refresh();
    });
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    if (!text.trim() || sending) return;
    if (intent === "request" && !selected.length && !steering) {
      setError("Choose who you would like to answer.");
      return;
    }
    setSending(true);
    setInputStatus("");
    await run(async () => {
      if (steering) {
        const receipt = await api<{ delivery: string }>(
          `/rooms/${roomId}/agents/${steering.id}/steer`,
          { text },
        );
        setInputStatus(
          receipt.delivery === "queued"
            ? "Input accepted and queued."
            : "Input accepted. The agent may finish its current tool before reading it.",
        );
        setSteering(null);
      } else {
        const signature = JSON.stringify({
          roomId,
          text,
          recipients: selected,
          intent,
        });
        if (publicationAttempt.current?.signature !== signature)
          publicationAttempt.current = {
            signature,
            requestId: crypto.randomUUID(),
          };
        await api(`/rooms/${roomId}/messages`, {
          text,
          requestId: publicationAttempt.current.requestId,
          recipients: selected,
          intent,
        });
        publicationAttempt.current = null;
      }
      setText("");
      setSelected([]);
      setIntent("post");
      setMention(null);
      follow.current = true;
    });
    setSending(false);
    composer.current?.focus();
  }
  function insertMention(person: {
    id: string;
    handle: string;
    agent: boolean;
  }) {
    setText((value) => value.replace(/@[\w-]*$/, "@" + person.handle + " "));
    setSelected((value) =>
      value.includes(person.id) ? value : [...value, person.id],
    );
    if (person.agent) setIntent("request");
    setMention(null);
    composer.current?.focus();
  }
  if (!ready) return <div className="loading">Opening bb Rooms…</div>;
  if (!user)
    return (
      <main className="auth">
        <div className="auth-brand">
          𝒃𝒃 <span>Rooms</span>
        </div>
        <div className="auth-card">
          <p className="eyebrow">HUMANS + AGENTS · ONE CONVERSATION</p>
          <h1>
            {authMode === "register"
              ? "A place to work together."
              : "Welcome back."}
          </h1>
          <p className="muted">
            {authMode === "register"
              ? "Create your own identity to join this room."
              : "Sign in to your shared workspace."}
          </p>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <form onSubmit={authenticate}>
            {authMode === "register" && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={80}
                />
              </label>
            )}
            <label>
              Handle
              <input
                name="handle"
                autoComplete="username"
                pattern="[a-z][a-z0-9_-]{1,31}"
                placeholder="chris"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  authMode === "register" ? "new-password" : "current-password"
                }
                minLength={12}
                required
              />
            </label>
            <button className="primary">
              {authMode === "register" ? "Join the room" : "Sign in"}
            </button>
          </form>
          {invitation && (
            <button
              className="link"
              onClick={() =>
                setAuthMode(authMode === "register" ? "login" : "register")
              }
            >
              {authMode === "register"
                ? "Already have an account? Sign in"
                : "Create an account with this invitation"}
            </button>
          )}
        </div>
        <p className="auth-foot">A shared conversation. Independent minds.</p>
      </main>
    );
  const owner = snapshot?.room.ownerId === user.id;
  function participantStatus(agent: Agent) {
    const deliveries =
      snapshot?.deliveries.filter(
        (delivery) => delivery.agentId === agent.id,
      ) ?? [];
    if (
      agent.status === "uncertain" ||
      deliveries.some((delivery) => delivery.state === "uncertain")
    )
      return "Needs attention";
    if (deliveries.some((delivery) => delivery.state === "running"))
      return "Working";
    if (deliveries.some((delivery) => delivery.state === "dispatching"))
      return "Starting";
    if (deliveries.some((delivery) => delivery.state === "queued"))
      return snapshot?.room.paused ? "Paused · queued" : "Queued";
    const latest = deliveries.toSorted((a, b) => b.createdAt - a.createdAt)[0];
    if (latest?.state === "error") return "Failed";
    if (latest?.state === "stopped") return "Stopped";
    if (latest?.outcome === "no_reply") return "No public reply";
    return agent.status === "idle" ? "Ready" : agent.status;
  }
  const participants = [
    ...(snapshot?.members.map((m) => ({ ...m, agent: false })) ?? []),
    ...(snapshot?.agents.map((a) => ({ ...a, agent: true })) ?? []),
  ];
  const mentionOptions =
    mention === null
      ? []
      : participants.filter((p) => p.handle.startsWith(mention.toLowerCase()));
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          𝒃𝒃 <span>Rooms</span>
          <span className="preview">PREVIEW</span>
        </div>
        <div className="section-label">
          WORK TOGETHER{" "}
          <button aria-label="Create room" onClick={() => setPanel("room")}>
            ＋
          </button>
        </div>
        {rooms.map((r) => (
          <button
            key={r.id}
            className={"room-link " + (r.id === roomId ? "active" : "")}
            onClick={() => setRoomId(r.id)}
          >
            <span>◈</span>
            {r.name}
          </button>
        ))}
        <div className="sidebar-note">
          One room. Many perspectives.
          <br />
          Address anyone with <kbd>@</kbd>.
        </div>
        <div className="self">
          <Avatar name={user.name} />
          <span>
            <strong>{user.name}</strong>
            <small>@{user.handle}</small>
          </span>
          <button
            aria-label="Sign out"
            onClick={() =>
              void run(async () => {
                await api("/logout", {});
                setUser(null);
                setSnapshot(null);
              })
            }
          >
            ↪
          </button>
        </div>
      </nav>
      <main className="room">
        <header>
          <div>
            <p className="eyebrow">SHARED WORKSPACE</p>
            <h1>{snapshot?.room.name ?? "Your rooms"}</h1>
          </div>
          <div className="header-actions">
            <span className={"connection " + (connected ? "online" : "")}>
              <i />
              {connected ? "Live" : "Reconnecting"}
            </span>
            <button onClick={() => setPanel("invite")}>
              People <span>{snapshot?.members.length ?? 0}</span>
            </button>
            {owner && (
              <>
                <button onClick={() => setPanel("agent")}>＋ Add agent</button>
                <button aria-label="Room controls" onClick={openRoomControls}>
                  ⋯
                </button>
              </>
            )}
          </div>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        {invitePending && (
          <button
            className="join-existing"
            onClick={() =>
              void run(async () => {
                await api("/join", { invite: invitation });
                setInvitePending(false);
                await refresh();
              })
            }
          >
            Accept invitation with this account
          </button>
        )}
        <div className="participant-bar">
          {snapshot?.agents.map((a) => (
            <button
              title={`Choose ${a.name} as a recipient`}
              key={a.id}
              className={
                "participant " + (selected.includes(a.id) ? "selected" : "")
              }
              aria-pressed={selected.includes(a.id)}
              onClick={() => {
                setSelected((v) =>
                  v.includes(a.id) ? v.filter((x) => x !== a.id) : [...v, a.id],
                );
                setIntent("request");
                composer.current?.focus();
              }}
            >
              <Avatar name={a.name} agent />
              <span>
                {a.name}
                <small>{participantStatus(a)}</small>
              </span>
              {a.status === "working" && <i className="pulse" />}
            </button>
          ))}
          {!snapshot?.agents.length && (
            <span className="muted">
              Invite an agent to start collaborating.
            </span>
          )}
          <div className="participant-spacer" />
          {snapshot?.members.map((m) => (
            <span
              key={m.id}
              title={`${m.name} · ${snapshot.online.includes(m.id) ? "online" : "offline"}`}
              className={
                "person " + (snapshot.online.includes(m.id) ? "present" : "")
              }
            >
              <Avatar name={m.name} />
            </span>
          ))}
        </div>
        {snapshot?.room.paused && (
          <div className="room-paused" role="status">
            <span>
              <strong>New agent turns paused</strong>{" "}
              {snapshot.room.pauseReason ?? "You can still message the room."}
            </span>
            {owner && (
              <button
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/rooms/${roomId}/policy`,
                      {
                        paused: false,
                        maxActivations: snapshot.room.maxActivations,
                      },
                      "PUT",
                    );
                  })
                }
              >
                Resume agents
              </button>
            )}
          </div>
        )}
        <div
          className="conversation"
          ref={scroll}
          onScroll={() => {
            const e = scroll.current;
            if (e)
              follow.current =
                e.scrollHeight - e.scrollTop - e.clientHeight < 100;
          }}
        >
          {!snapshot?.messages.length && (
            <section className="empty">
              <span className="empty-mark">◈</span>
              <h2>Bring everyone into the work.</h2>
              <p>
                Ask a question, invite a second perspective, or give each agent
                a part of the problem. Everyone follows along here.
              </p>
              <div className="starters">
                <button
                  onClick={() => {
                    setText(
                      `${snapshot?.agents.map((a) => "@" + a.handle).join(" ") ?? ""} Introduce yourselves and explain how you can work together.`,
                    );
                    setSelected(snapshot?.agents.map((a) => a.id) ?? []);
                    setIntent("request");
                    composer.current?.focus();
                  }}
                >
                  Meet your collaborators <span>↗</span>
                </button>
                <button
                  onClick={() => {
                    setText(
                      `${snapshot?.agents.map((a) => "@" + a.handle).join(" ") ?? ""} Propose a plan for a shared task board. Each share your own perspective.`,
                    );
                    setSelected(snapshot?.agents.map((a) => a.id) ?? []);
                    setIntent("request");
                    composer.current?.focus();
                  }}
                >
                  Get two perspectives <span>↗</span>
                </button>
              </div>
            </section>
          )}
          {snapshot?.messages.map((m) => (
            <article
              className={"message " + m.kind}
              key={m.id}
              data-message-id={m.id}
              data-author={m.authorName}
              data-author-id={m.authorId}
              data-status={m.status}
            >
              <Avatar name={m.authorName} agent={m.kind === "agent"} />
              <div className="message-body">
                <div className="message-meta">
                  <strong>
                    {m.kind === "system" ? "Room status" : m.authorName}
                  </strong>
                  {m.kind === "agent" && <span className="tag">AGENT</span>}
                  <time dateTime={new Date(m.createdAt).toISOString()}>
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  {m.status === "streaming" && (
                    <span className="stream-label">
                      writing<span className="dots">…</span>
                    </span>
                  )}
                </div>
                {m.recipients.length > 0 && (
                  <div className="message-recipients">
                    {m.intent === "request"
                      ? "Asked"
                      : m.intent === "notice"
                        ? "Shared with"
                        : "To"}{" "}
                    {m.recipients
                      .map(
                        (id) =>
                          participants.find((p) => p.id === id)?.name ??
                          "Former participant",
                      )
                      .join(", ")}
                  </div>
                )}
                <div className="prose">
                  <Markdown>{m.text || "…"}</Markdown>
                </div>
                {m.status === "stopped" && (
                  <small>Publication interrupted</small>
                )}
                {m.status === "error" && (
                  <small>Could not complete publication</small>
                )}
              </div>
            </article>
          ))}
          {sending && (
            <div className="sending-notice" role="status">
              Sending your message…
            </div>
          )}
          {snapshot && (
            <PendingReplies
              snapshot={snapshot}
              decisionAgents={pending.map((p) => p.agent.id)}
            />
          )}
          <div ref={end} />
        </div>
        {pending.map((item) => (
          <div className="approval" key={item.id}>
            <strong>{item.agent.name} needs a decision</strong>
            <details>
              <summary>Details</summary>
              <pre>{JSON.stringify(item.payload, null, 2)}</pre>
            </details>
            {owner && isApprovalPendingInteractionPayload(item.payload) ? (
              <ApprovalControls
                payload={item.payload}
                submit={(body) =>
                  run(async () => {
                    await api(
                      `/rooms/${roomId}/agents/${item.agent.id}/interactions/${item.id}`,
                      body,
                    );
                  })
                }
              />
            ) : owner && item.payload.kind === "user_question" ? (
              <QuestionForm
                payload={item.payload}
                submit={(body) =>
                  run(async () => {
                    await api(
                      `/rooms/${roomId}/agents/${item.agent.id}/interactions/${item.id}`,
                      body,
                    );
                  })
                }
              />
            ) : (
              <span>Room owner can respond.</span>
            )}
          </div>
        ))}
        <footer>
          <div className="working">
            {snapshot?.agents
              .filter((a) => ["working", "starting"].includes(a.status))
              .map((a) => (
                <span key={a.id}>
                  <i className="pulse" />
                  {a.name} is {a.status === "starting" ? "starting" : "working"}
                  <button
                    onClick={() => {
                      setSelected([a.id]);
                      setIntent("request");
                      composer.current?.focus();
                    }}
                  >
                    Follow up
                  </button>
                  {["pi", "codex", "claude-code"].includes(a.provider) &&
                    a.status === "working" && (
                      <button
                        onClick={() => {
                          setSteering(a);
                          setSelected([a.id]);
                          composer.current?.focus();
                        }}
                      >
                        Steer now
                      </button>
                    )}
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api(`/rooms/${roomId}/agents/${a.id}/stop`, {});
                      })
                    }
                  >
                    Stop
                  </button>
                </span>
              ))}
          </div>
          {inputStatus && (
            <div className="input-status" role="status">
              {inputStatus}
            </div>
          )}
          <form className="composer" onSubmit={send}>
            {steering && (
              <div className="steer-label">
                Send input to {steering.name} during this turn
                <button type="button" onClick={() => setSteering(null)}>
                  Cancel steering
                </button>
              </div>
            )}
            <div className="composer-intent">
              <label>
                <span className="visually-hidden">Message intent</span>
                <select
                  aria-label="Message intent"
                  value={intent}
                  onChange={(event) =>
                    setIntent(
                      event.target.value === "request"
                        ? "request"
                        : event.target.value === "notice"
                          ? "notice"
                          : "post",
                    )
                  }
                >
                  <option value="post">Message</option>
                  <option value="request">Ask for a response</option>
                  <option value="notice">Share context</option>
                </select>
              </label>
              <span>
                {intent === "request"
                  ? "Choose who should answer"
                  : intent === "notice"
                    ? "Recipients respond only when useful"
                    : "Visible to everyone; no response requested"}
              </span>
            </div>
            {selected.length > 0 && (
              <div className="recipient-chips" aria-label="Selected recipients">
                {selected.map((id) => {
                  const person = participants.find((p) => p.id === id);
                  return (
                    person && (
                      <button
                        key={id}
                        type="button"
                        aria-label={`Remove ${person.name} recipient`}
                        onClick={() =>
                          setSelected((value) =>
                            value.filter((entry) => entry !== id),
                          )
                        }
                      >
                        {person.name} <span aria-hidden="true">×</span>
                      </button>
                    )
                  );
                })}
              </div>
            )}
            {mention !== null && (
              <div className="mentions" role="listbox">
                {mentionOptions.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    role="option"
                    aria-selected="false"
                    onClick={() => insertMention(p)}
                  >
                    <Avatar name={p.name} agent={p.agent} />
                    <strong>{p.name}</strong>
                    <span>@{p.handle}</span>
                  </button>
                ))}
                {!mentionOptions.length && <span>No matching participant</span>}
              </div>
            )}
            <textarea
              ref={composer}
              aria-label="Message the room"
              placeholder="Message the room… use @ to bring someone in"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const match = e.target.value.match(/(?:^|\s)@([\w-]*)$/);
                setMention(match ? match[1] : null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMention(null);
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (mentionOptions.length && mention !== null) {
                    insertMention(mentionOptions[0]);
                  } else void send();
                }
              }}
            />
            <div className="composer-bottom">
              <span>
                {snapshot?.room.paused
                  ? "New turns are paused; requests will wait"
                  : selected.length
                    ? `To ${selected
                        .map(
                          (id) => participants.find((p) => p.id === id)?.name,
                        )
                        .filter(Boolean)
                        .join(", ")}`
                    : "Use @ to choose participants"}
              </span>
              <button
                type="submit"
                className="send"
                disabled={!text.trim() || sending}
                aria-label="Send message"
              >
                ↑
              </button>
            </div>
          </form>
          <div className="footer-note">
            <span>Enter to send · Shift Enter for a new line</span>
            {owner && snapshot && (
              <button
                className="link"
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/rooms/${roomId}/policy`,
                      {
                        paused: !snapshot.room.paused,
                        maxActivations: snapshot.room.maxActivations,
                      },
                      "PUT",
                    );
                  })
                }
              >
                {snapshot.room.paused ? "Resume agents" : "Pause new turns"}
              </button>
            )}
          </div>
        </footer>
      </main>
      <ResponsiveDrawerShell
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
        labelledBy="room-panel-title"
        contentClassName="rooms-drawer"
      >
        <aside className="panel">
          <div className="panel-title">
            <h2 id="room-panel-title">
              {realizedPanel === "agent"
                ? "Add an agent"
                : realizedPanel === "room"
                  ? "New room"
                  : realizedPanel === "settings"
                    ? "Room controls"
                    : realizedPanel === "activity"
                      ? "Agent activity"
                      : "People in this room"}
            </h2>
            <button onClick={() => setPanel(null)} aria-label="Close panel">
              ×
            </button>
          </div>
          {realizedPanel === "settings" && snapshot && (
            <form
              key={snapshot.room.id}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const value = String(form.get("maxActivations") ?? "").trim();
                void run(async () => {
                  await api(
                    `/rooms/${roomId}/policy`,
                    {
                      paused: snapshot.room.paused,
                      maxActivations: value ? Number(value) : null,
                    },
                    "PUT",
                  );
                  setPanel(null);
                });
              }}
            >
              <p className="muted">
                An agent turn is one opportunity to read and contribute. A turn
                may end without a public reply.
              </p>
              <label>
                Agent turn budget
                <input
                  name="maxActivations"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  value={budgetDraft}
                  onChange={(event) => setBudgetDraft(event.target.value)}
                  placeholder="Unlimited"
                />
                <small>
                  Leave empty for unlimited turns. Reaching the budget pauses
                  agents visibly. Resuming starts a new budget.
                </small>
              </label>
              <p>
                {snapshot.room.activationsUsed} agent turns used
                {snapshot.room.maxActivations === null
                  ? " · no limit"
                  : ` of ${snapshot.room.maxActivations}`}
                .
              </p>
              <button className="primary">Save controls</button>
              {snapshot.agents.length > 0 && (
                <button
                  type="button"
                  className="activity-link"
                  onClick={() => {
                    setActivityAgentId(snapshot.agents[0].id);
                    setPanel("activity");
                  }}
                >
                  View agent activity
                </button>
              )}
            </form>
          )}
          {realizedPanel === "activity" && owner && snapshot && (
            <section>
              <p className="muted">
                Execution details are visible to the room owner. Agents choose
                which messages to share in the conversation.
              </p>
              <label>
                Agent
                <select
                  value={activityAgentId}
                  onChange={(event) => setActivityAgentId(event.target.value)}
                >
                  {snapshot.agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              {snapshot.agents
                .filter((agent) => agent.id === activityAgentId)
                .map((agent) => (
                  <dl className="activity-details" key={agent.id}>
                    <dt>Participant</dt>
                    <dd>{agent.name}</dd>
                    <dt>Provider</dt>
                    <dd>{agent.provider}</dd>
                    <dt>Model</dt>
                    <dd>{agent.model || "Provider default"}</dd>
                    <dt>Room status</dt>
                    <dd>{participantStatus(agent)}</dd>
                    <dt>Execution</dt>
                    <dd>
                      {activity
                        ? (activity.providerStatus ?? "No private session")
                        : activityError
                          ? "Unavailable"
                          : "Loading…"}
                    </dd>
                    <dt>Started</dt>
                    <dd>
                      {activity?.startedAt
                        ? new Date(activity.startedAt).toLocaleString()
                        : "No active turn"}
                    </dd>
                    {activity?.threadId && (
                      <>
                        <dt>Private session</dt>
                        <dd>
                          <code>{activity.threadId}</code>
                        </dd>
                      </>
                    )}
                    {activity?.deliveryId && (
                      <>
                        <dt>Request</dt>
                        <dd>
                          <code>{activity.deliveryId}</code>
                        </dd>
                      </>
                    )}
                    {agent.status === "uncertain" && (
                      <>
                        <dt>Recovery</dt>
                        <dd>
                          <p>
                            Stop any remaining private execution. The original
                            message will not be resent.
                          </p>
                          <button
                            onClick={() =>
                              void run(async () => {
                                await api(
                                  `/rooms/${roomId}/agents/${agent.id}/recover`,
                                  {},
                                );
                              })
                            }
                          >
                            Resolve interrupted dispatch
                          </button>
                        </dd>
                      </>
                    )}
                  </dl>
                ))}
              {activityError && (
                <p className="error" role="alert">
                  {activityError}
                </p>
              )}
              {!activity && !activityError && (
                <p role="status">Loading activity…</p>
              )}
              <button onClick={openRoomControls}>Back to room controls</button>
            </section>
          )}
          {realizedPanel === "agent" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = Object.fromEntries(new FormData(form));
                void run(async () => {
                  await api(`/rooms/${roomId}/agents`, data);
                  form.reset();
                  setPanel(null);
                });
              }}
            >
              <p className="muted">
                Each agent gets its own persistent conversation and workspace.
              </p>
              <label>
                Name
                <input name="name" placeholder="Nova" required maxLength={80} />
              </label>
              <label>
                Handle
                <input
                  name="handle"
                  placeholder="nova"
                  pattern="[a-z][a-z0-9_-]{1,31}"
                  required
                />
              </label>
              <label>
                Provider
                <select name="provider" defaultValue="pi">
                  <option value="claude-code">Claude Code</option>
                  <option value="codex">Codex</option>
                  <option value="pi">Pi (local or cloud models)</option>
                </select>
              </label>
              <label>
                Model <small>Optional; uses provider default</small>
                <input name="model" placeholder="Provider default" />
              </label>
              <label>
                Instructions
                <textarea
                  name="instructions"
                  placeholder="What perspectives or expertise should this participant bring?"
                />
              </label>
              <button className="primary">Add agent</button>
            </form>
          )}
          {realizedPanel === "room" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = Object.fromEntries(new FormData(form));
                void run(async () => {
                  const r = await api<Room>("/rooms", data);
                  form.reset();
                  await refresh();
                  setRoomId(r.id);
                  setPanel(null);
                });
              }}
            >
              <label>
                Room name
                <input name="name" required autoFocus />
              </label>
              <button className="primary">Create room</button>
            </form>
          )}
          {realizedPanel === "invite" && (
            <>
              <p className="muted">
                Every person signs in with their own identity. Everyone can
                speak and address agents independently.
              </p>
              {snapshot?.members.map((m) => (
                <div className="member" key={m.id}>
                  <Avatar name={m.name} />
                  <span>
                    <strong>{m.name}</strong>
                    <small>
                      @{m.handle} · {m.role}
                    </small>
                  </span>
                  {owner && m.id !== user.id && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          await api(
                            `/rooms/${roomId}/members/${m.id}`,
                            undefined,
                            "DELETE",
                          );
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {owner && (
                <>
                  <button
                    className="primary"
                    onClick={() =>
                      void run(async () => {
                        const r = await api<{ invite: string }>(
                          `/rooms/${roomId}/invites`,
                          {},
                        );
                        setInviteUrl(location.origin + "/#invite=" + r.invite);
                      })
                    }
                  >
                    Create invitation
                  </button>
                  {inviteUrl && (
                    <label>
                      One-time invitation
                      <input
                        readOnly
                        value={inviteUrl}
                        onFocus={(e) => e.target.select()}
                      />
                      <button
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(inviteUrl)
                            .catch((e) => setError(String(e)))
                        }
                      >
                        Copy link
                      </button>
                      <small>
                        Expires in seven days. Each invitation admits one
                        person.
                      </small>
                    </label>
                  )}
                </>
              )}
            </>
          )}
        </aside>
      </ResponsiveDrawerShell>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
