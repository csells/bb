import { userQuestionPendingInteractionPayloadSchema } from "@bb/domain";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
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
    ["queued", "dispatching", "running"].includes(d.state),
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
    if (
      !needsDecision &&
      latest?.kind === "agent" &&
      latest.status === "streaming" &&
      latest.text.trim()
    )
      return null;
    const cause = snapshot.messages.find((m) => m.id === delivery.messageId);
    const since = delivery.startedAt ?? cause?.createdAt;
    const elapsed =
      since === undefined
        ? null
        : Math.max(0, Math.floor((now - since) / 1000));
    const state = needsDecision
      ? `${agent.name} needs a decision`
      : delivery.state === "queued"
        ? `Queued for ${agent.name}`
        : delivery.state === "dispatching"
          ? `Starting ${agent.name}`
          : output.length
            ? `${agent.name} is working`
            : `Waiting for ${agent.name}’s first response`;
    return (
      <div
        className="message pending-reply"
        key={delivery.id}
        data-agent-id={agent.id}
      >
        <Avatar name={agent.name} agent />
        <div className="message-body">
          <div className="pending-heading">
            <span className="pending-status" role="status">
              <i className="pulse" aria-hidden="true" />
              {state}
            </span>
            {elapsed !== null && (
              <span className="pending-elapsed" aria-label="Elapsed time">
                {elapsed < 60
                  ? `${elapsed}s`
                  : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
              </span>
            )}
          </div>
          <p>
            {needsDecision
              ? "Review the request below to continue."
              : "You can keep typing while you wait."}
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
    [panel, setPanel] = useState<"agent" | "invite" | "room" | null>(null),
    [inviteUrl, setInviteUrl] = useState(""),
    [sending, setSending] = useState(false),
    [steering, setSteering] = useState<Agent | null>(null);
  const [invitePending, setInvitePending] = useState(Boolean(invitation));
  const [authMode, setAuthMode] = useState(invitation ? "register" : "login");
  const [mention, setMention] = useState<string | null>(null);
  const [pending, setPending] = useState<
    {
      agent: Agent;
      id: string;
      payload: { kind: string; [key: string]: unknown };
    }[]
  >([]);
  const end = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    follow = useRef(true);
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
    if (!snapshot) return;
    let active = true;
    const poll = async () => {
      try {
        const groups = await Promise.all(
          snapshot.agents
            .filter((a) => a.threadId)
            .map(async (agent) => {
              const response = await api<
                {
                  id: string;
                  payload: { kind: string; [key: string]: unknown };
                }[]
              >(`/rooms/${roomId}/agents/${agent.id}/interactions`);
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
    setSending(true);
    await run(async () => {
      if (steering) {
        await api(`/rooms/${roomId}/agents/${steering.id}/steer`, { text });
        setSteering(null);
      } else
        await api(`/rooms/${roomId}/messages`, {
          text,
          requestId: crypto.randomUUID(),
          recipients: selected,
        });
      setText("");
      setMention(null);
      follow.current = true;
    });
    setSending(false);
    composer.current?.focus();
  }
  function insertMention(handle: string) {
    setText((value) => value.replace(/@[\w-]*$/, "@" + handle + " "));
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
              <button onClick={() => setPanel("agent")}>＋ Add agent</button>
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
              title={`Send next prompt to ${a.name}`}
              key={a.id}
              className={
                "participant " + (selected.includes(a.id) ? "selected" : "")
              }
              onClick={() =>
                setSelected((v) =>
                  v.includes(a.id) ? v.filter((x) => x !== a.id) : [...v, a.id],
                )
              }
            >
              <Avatar name={a.name} agent />
              <span>
                {a.name}
                <small>{a.status === "idle" ? a.provider : a.status}</small>
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
                    composer.current?.focus();
                  }}
                >
                  Meet your collaborators <span>↗</span>
                </button>
                <button
                  onClick={() => {
                    setText(
                      `${snapshot?.agents.map((a) => "@" + a.handle).join(" ") ?? ""} Propose a plan for a shared task board. Each respond from your own role and review the tradeoffs independently.`,
                    );
                    composer.current?.focus();
                  }}
                >
                  Get two perspectives <span>↗</span>
                </button>
              </div>
            </section>
          )}
          {snapshot?.messages.map((m) =>
            m.kind === "tool" ? (
              <details className="tool" key={m.id}>
                <summary>
                  <span className={m.status === "streaming" ? "pulse" : ""}>
                    ⌘
                  </span>{" "}
                  {m.authorName} · {m.text.split("\n")[0].slice(0, 120)}
                  {m.status === "streaming" ? " · running" : ""}
                </summary>
                <pre>{m.text}</pre>
              </details>
            ) : (
              <article
                className={"message " + m.kind}
                key={m.id}
                data-message-id={m.id}
                data-author={m.authorName}
                data-status={m.status}
              >
                <Avatar name={m.authorName} agent={m.kind === "agent"} />
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{m.authorName}</strong>
                    {m.kind === "agent" && <span className="tag">AGENT</span>}
                    <time>
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
                  <div className="prose">
                    <Markdown>{m.text || "…"}</Markdown>
                  </div>
                  {m.status === "stopped" && <small>Stopped</small>}
                </div>
              </article>
            ),
          )}
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
            {owner && item.payload.kind === "approval" ? (
              <>
                <button
                  onClick={() =>
                    void run(async () => {
                      await api(
                        `/rooms/${roomId}/agents/${item.agent.id}/interactions/${item.id}`,
                        { decision: "allow_once", grantedPermissions: null },
                      );
                    })
                  }
                >
                  Allow once
                </button>
                <button
                  onClick={() =>
                    void run(async () => {
                      await api(
                        `/rooms/${roomId}/agents/${item.agent.id}/interactions/${item.id}`,
                        { decision: "deny" },
                      );
                    })
                  }
                >
                  Deny
                </button>
              </>
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
                      setSteering(a);
                      composer.current?.focus();
                    }}
                  >
                    Steer
                  </button>
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
          <form className="composer" onSubmit={send}>
            {mention !== null && (
              <div className="mentions" role="listbox">
                {mentionOptions.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    role="option"
                    aria-selected="false"
                    onClick={() => insertMention(p.handle)}
                  >
                    <Avatar name={p.name} agent={p.agent} />
                    <strong>{p.name}</strong>
                    <span>@{p.handle}</span>
                  </button>
                ))}
                {!mentionOptions.length && <span>No matching participant</span>}
              </div>
            )}
            {steering && (
              <div className="steer-label">
                Steering {steering.name}
                <button type="button" onClick={() => setSteering(null)}>
                  Cancel
                </button>
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
                    insertMention(mentionOptions[0].handle);
                  } else void send();
                }
              }}
            />
            <div className="composer-bottom">
              <span>
                {steering
                  ? "Interrupt and redirect this agent"
                  : selected.length
                    ? "To " +
                      snapshot?.agents
                        .filter((a) => selected.includes(a.id))
                        .map((a) => a.name)
                        .join(", ")
                    : "@mention agents to request a response"}
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
            {owner && (
              <label>
                Default{" "}
                <select
                  aria-label="Default agent"
                  value={snapshot?.room.defaultAgentId ?? ""}
                  onChange={(e) =>
                    void run(async () => {
                      await api(
                        `/rooms/${roomId}/default`,
                        { agentId: e.target.value || null },
                        "PUT",
                      );
                    })
                  }
                >
                  <option value="">Mentions only</option>
                  {snapshot?.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </footer>
      </main>
      {panel && (
        <aside className="panel">
          <div className="panel-title">
            <h2>
              {panel === "agent"
                ? "Add an agent"
                : panel === "room"
                  ? "New room"
                  : "People in this room"}
            </h2>
            <button onClick={() => setPanel(null)} aria-label="Close panel">
              ×
            </button>
          </div>
          {panel === "agent" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.currentTarget));
                void run(async () => {
                  await api(`/rooms/${roomId}/agents`, data);
                  setPanel(null);
                });
              }}
            >
              <p className="muted">
                Each agent gets its own persistent conversation and workspace.
              </p>
              <label>
                Name
                <input
                  name="name"
                  placeholder="Claude"
                  required
                  maxLength={80}
                />
              </label>
              <label>
                Handle
                <input
                  name="handle"
                  placeholder="claude"
                  pattern="[a-z][a-z0-9_-]{1,31}"
                  required
                />
              </label>
              <label>
                Provider
                <select name="provider">
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
                Role / instructions
                <textarea
                  name="instructions"
                  placeholder="Review designs, challenge assumptions, and propose alternatives."
                />
              </label>
              <button className="primary">Add agent</button>
            </form>
          )}
          {panel === "room" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.currentTarget));
                void run(async () => {
                  const r = await api<Room>("/rooms", data);
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
          {panel === "invite" && (
            <>
              <p className="muted">
                Every person signs in with their own identity. Room members can
                prompt and steer agents.
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
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
