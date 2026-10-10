import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { z } from "zod";
import {
  pendingInteractionStatusSchema,
  roomsRoomSchema,
  roomsSnapshotSchema,
  type RoomsAgent,
  type RoomsSnapshot,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Textarea } from "@bb/shared-ui/textarea";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { useRoomsIndex } from "@/hooks/queries/rooms-query";
import { getThreadRoutePath } from "@/lib/route-paths";
import { RoomContextSummary } from "./RoomContextSummary";
import { RoomContextFields, readRoomContext } from "./RoomContextFields";
import { RoomAgentForm } from "./RoomAgentForm";
import {
  loadRoom,
  RoomsRequestError,
  roomPath,
  roomsRequest,
} from "./rooms-api";

const fieldClass = "flex flex-col gap-2 text-sm";
const activeStates = new Set(["queued", "dispatching", "running", "uncertain"]);
type Panel = "create" | "people" | "agent" | "controls" | null;

function RoomDrawer({
  open,
  title,
  close,
  children,
}: {
  open: boolean;
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <ResponsiveDrawerShell
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
      srLabel={title}
      contentClassName="bg-background text-foreground"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-xl flex-col gap-5 overflow-y-auto p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Close ${title}`}
            onClick={close}
          >
            <Icon name="X" />
          </Button>
        </div>
        {children}
      </div>
    </ResponsiveDrawerShell>
  );
}

function ThreadLink({ agent }: { agent: RoomsAgent }) {
  if (!agent.threadId || !agent.projectId)
    return (
      <span className="text-xs text-muted-foreground">
        Thread starts with the first message
      </span>
    );
  return (
    <Button asChild size="sm" variant="outline">
      <Link
        to={getThreadRoutePath({
          projectId: agent.projectId,
          threadId: agent.threadId,
        })}
      >
        Open {agent.name}’s thread
        <Icon name="ArrowUpRight" />
      </Link>
    </Button>
  );
}

export function RoomsView() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const roomsIndex = useRoomsIndex();
  const session = roomsIndex.data ?? null;
  const [snapshot, setSnapshot] = useState<RoomsSnapshot | null>(null);
  const [actionError, setActionError] = useState("");
  const [transportError, setTransportError] = useState("");
  const [connected, setConnected] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [createFormVersion, setCreateFormVersion] = useState(0);
  const [text, setText] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [mention, setMention] = useState<string | null>(null);
  const [steering, setSteering] = useState<RoomsAgent | null>(null);
  const [sending, setSending] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [status, setStatus] = useState("");
  const [now, setNow] = useState(Date.now);
  const roomEpoch = useRef(0);
  const draft = useRef({ text, recipients, steering });
  draft.current = { text, recipients, steering };
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const publication = useRef<{ signature: string; requestId: string } | null>(
    null,
  );
  const owner = Boolean(session && snapshot?.room.ownerId === session.user.id);
  const inspectedAgents =
    owner && session?.access.operator
      ? (snapshot?.agents.filter(
          (agent) =>
            agent.threadId &&
            snapshot.deliveries.some(
              (delivery) =>
                delivery.agentId === agent.id && delivery.state === "running",
            ),
        ) ?? [])
      : [];
  const pendingQueries = useQueries({
    queries: inspectedAgents.map((agent) => ({
      queryKey: ["rooms", "pending-input", session?.user.id, roomId, agent.id],
      queryFn: async () =>
        z
          .array(z.object({ status: pendingInteractionStatusSchema }))
          .parse(
            await roomsRequest(
              `${roomPath(agent.roomId)}/agents/${agent.id}/interactions`,
            ),
          )
          .some(
            (interaction) =>
              interaction.status === "pending" ||
              interaction.status === "resolving",
          ),
      refetchInterval: 2000,
      retry: false,
    })),
  });
  const pendingInput = new Map(
    inspectedAgents.map((agent, index) => [agent.id, pendingQueries[index]!]),
  );
  const participants = snapshot
    ? [
        ...snapshot.members.map((member) => ({ ...member, agent: false })),
        ...snapshot.agents.map((agent) => ({ ...agent, agent: true })),
      ]
    : [];
  const options = participants.filter(
    (person) =>
      person.id !== session?.user.id &&
      (!mention ||
        `${person.name} ${person.handle}`
          .toLowerCase()
          .includes(mention.toLowerCase())),
  );

  async function refreshSession() {
    const result = await roomsIndex.refetch({ throwOnError: true });
    if (!result.data) throw new Error("Unable to load your rooms");
    return result.data;
  }
  async function perform(action: () => Promise<void>) {
    const epoch = roomEpoch.current;
    setActionError("");
    try {
      await action();
    } catch (problem) {
      if (roomEpoch.current === epoch)
        setActionError(
          problem instanceof Error ? problem.message : String(problem),
        );
    }
  }
  useEffect(() => {
    roomEpoch.current += 1;
    setSnapshot(null);
    setConnected(false);
    setTransportError("");
    setActionError("");
    setSending(false);
    setRecipients([]);
    setText("");
    setMention(null);
    setSteering(null);
    setStatus("");
    setInviteUrl("");
    setPanel(null);
    publication.current = null;
    follow.current = true;
    if (!roomId || !session) return;
    let active = true;
    let live = false;
    let revoked = false;
    let timer: ReturnType<typeof setTimeout>;
    const events = new EventSource(
      `/api/rooms/${encodeURIComponent(roomId)}/events`,
    );
    const accept = (next: RoomsSnapshot) => {
      if (!active || revoked) return;
      setSnapshot((current) =>
        current && current.room.revision > next.room.revision ? current : next,
      );
      setConnected(true);
      setTransportError("");
    };
    events.addEventListener("snapshot", (event) => {
      try {
        accept(roomsSnapshotSchema.parse(JSON.parse(event.data)));
        live = true;
      } catch (problem) {
        if (active)
          setTransportError(
            problem instanceof Error ? problem.message : String(problem),
          );
      }
    });
    events.addEventListener("access-error", (event) => {
      const problem = z
        .object({ error: z.string() })
        .safeParse(JSON.parse(event.data));
      revoked = true;
      live = false;
      events.close();
      setSnapshot(null);
      setConnected(false);
      setTransportError(
        problem.success ? problem.data.error : "Room access ended",
      );
      void refreshSession().catch((problem: Error) => {
        if (active) setTransportError(problem.message);
      });
    });
    events.onerror = () => {
      live = false;
      if (active) setConnected(false);
    };
    const poll = async () => {
      if (!active || revoked) return;
      try {
        if (!live) accept(await loadRoom(roomId));
      } catch (problem) {
        if (active) {
          setConnected(false);
          setTransportError(
            problem instanceof Error ? problem.message : String(problem),
          );
          if (
            problem instanceof RoomsRequestError &&
            [401, 403, 404].includes(problem.status)
          ) {
            revoked = true;
            events.close();
            setSnapshot(null);
          }
        }
      } finally {
        if (active && !revoked) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      events.close();
    };
  }, [roomId, session?.user.id]);
  useEffect(() => {
    if (follow.current) end.current?.scrollIntoView({ block: "end" });
  }, [snapshot?.room.revision]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  function selectRecipient(person: (typeof participants)[number]) {
    setRecipients((current) =>
      current.includes(person.id) ? current : [...current, person.id],
    );
    setText((current) =>
      mention === null
        ? current
        : current.replace(/@[\w-]*$/, `@${person.handle} `),
    );
    setMention(null);
    composer.current?.focus();
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!roomId || !text.trim() || sending) return;
    const epoch = roomEpoch.current;
    const submitted = draft.current;
    setSending(true);
    await perform(async () => {
      if (steering) {
        const receipt = z
          .object({ delivery: z.string() })
          .parse(
            await roomsRequest(
              `${roomPath(roomId)}/agents/${steering.id}/steer`,
              { text },
            ),
          );
        if (roomEpoch.current !== epoch) return;
        setStatus(
          receipt.delivery === "queued"
            ? "Your input is queued for this turn."
            : "Your input reached the active turn.",
        );
      } else {
        const body = {
          text,
          recipients,
          intent: recipients.length ? "request" : "post",
          replyTo: null,
        };
        const signature = JSON.stringify({ roomId, ...body });
        if (publication.current?.signature !== signature)
          publication.current = { signature, requestId: crypto.randomUUID() };
        const request = publication.current;
        await roomsRequest(`${roomPath(roomId)}/messages`, {
          ...body,
          requestId: request.requestId,
        });
        if (publication.current === request) publication.current = null;
      }
      if (roomEpoch.current !== epoch) return;
      if (
        draft.current.text === submitted.text &&
        draft.current.recipients === submitted.recipients &&
        draft.current.steering === submitted.steering
      ) {
        setText("");
        setRecipients([]);
        setMention(null);
        setSteering(null);
      }
      follow.current = true;
    });
    if (roomEpoch.current !== epoch) return;
    setSending(false);
    composer.current?.focus();
  }

  return (
    <section
      className="-mx-4 -mt-4 -mb-4 flex min-h-0 flex-1 flex-col md:-mx-5 md:-mt-5 md:-mb-5"
      aria-label="Rooms"
    >
      <AppPageHeader
        center={
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/rooms">Rooms</Link>
            </Button>
            {snapshot && (
              <>
                <span className="text-muted-foreground">/</span>
                <h1 className="truncate text-sm font-semibold">
                  {snapshot.room.name}
                </h1>
              </>
            )}
          </div>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPanel("create")}
            >
              <Icon name="Plus" />
              New room
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPanel("people")}
              aria-label={snapshot ? "Room participants" : "Account"}
            >
              <Icon name="UserRound" />
              <span>
                {snapshot
                  ? snapshot.members.length + snapshot.agents.length
                  : "Account"}
              </span>
            </Button>
          </>
        }
      />
      {(actionError || transportError || roomsIndex.error) && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-border bg-surface-recessed p-3 text-sm"
        >
          <span>
            {actionError || transportError || roomsIndex.error?.message}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActionError("");
              setTransportError("");
              if (roomsIndex.error) void roomsIndex.refetch();
            }}
          >
            {roomsIndex.error ? "Retry" : "Dismiss"}
          </Button>
        </div>
      )}
      {!session ? (
        <div className="p-6 text-sm text-muted-foreground" role="status">
          Opening your rooms…
        </div>
      ) : !roomId ? (
        <div className="mx-auto w-full max-w-3xl space-y-6 overflow-y-auto p-6">
          <div>
            <h1 className="text-xl font-semibold">Rooms</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Shared conversations with people and independent agents. Your
              projects, sections and agent threads stay in BB’s sidebar.
            </p>
          </div>
          {session.rooms.length ? (
            <div className="grid gap-3">
              {session.rooms.map((room) => (
                <Link
                  key={room.id}
                  to={roomPath(room.id)}
                  className="flex items-center gap-3 rounded-xl border border-border p-4 hover:bg-state-hover"
                >
                  <Icon name="MessageSquare" />
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="font-medium">{room.name}</span>
                    {session.access.operator && (
                      <RoomContextSummary room={room} />
                    )}
                  </span>
                  <Icon name="ChevronRight" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No rooms yet. Create a room to invite people and agents.
            </p>
          )}
          <Button onClick={() => setPanel("create")}>
            <Icon name="Plus" />
            Create room
          </Button>
        </div>
      ) : !snapshot ? (
        <div className="p-6" role="status">
          Opening the room…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <span className="mr-1 text-xs text-muted-foreground" role="status">
              {connected ? "Live" : "Reconnecting…"}
            </span>
            {session.access.operator && (
              <RoomContextSummary room={snapshot.room} />
            )}
            {snapshot.agents.map((agent) => (
              <Button
                key={agent.id}
                size="sm"
                variant="outline"
                onClick={() => setPanel("people")}
              >
                <Icon name="Bot" />
                {agent.name}
                <span className="text-xs text-muted-foreground">
                  {pendingInput.get(agent.id)?.data
                    ? "Awaiting input"
                    : agent.status}
                </span>
              </Button>
            ))}
            {owner && session.access.operator && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPanel("agent")}
              >
                <Icon name="Plus" />
                Add agent
              </Button>
            )}
            {owner && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPanel("controls")}
              >
                Room controls
              </Button>
            )}
          </div>
          <div
            ref={scroll}
            data-testid="room-history"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5"
            onScroll={() => {
              const element = scroll.current;
              if (element)
                follow.current =
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight <
                  100;
            }}
          >
            <div className="mx-auto max-w-3xl space-y-6">
              {!snapshot.messages.length && (
                <p className="text-sm text-muted-foreground">
                  Start a conversation. Everyone can follow along; use @ to ask
                  someone directly.
                </p>
              )}
              {snapshot.messages.map((message) => (
                <Fragment key={message.id}>
                  <article
                    data-room-message={message.id}
                    className="rounded-xl border border-border p-4"
                  >
                    <header className="mb-3 flex items-center gap-2 text-sm">
                      <Icon
                        name={message.kind === "agent" ? "Bot" : "UserRound"}
                      />
                      <strong>{message.authorName}</strong>
                      <span className="text-xs text-muted-foreground">
                        {message.kind === "agent" ? "Agent · " : ""}
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {message.status === "streaming" && (
                        <span
                          className="text-xs text-muted-foreground"
                          role="status"
                        >
                          Sharing…
                        </span>
                      )}
                    </header>
                    {message.recipients.length > 0 && (
                      <p className="mb-2 text-xs text-muted-foreground">
                        Asked{" "}
                        {message.recipients
                          .map(
                            (id) =>
                              participants.find((person) => person.id === id)
                                ?.name ?? "Former participant",
                          )
                          .join(", ")}
                      </p>
                    )}
                    <MarkdownPreview
                      content={message.text || "…"}
                      incrementalBlocks
                      imagePolicy="alt-text"
                    />
                    {["stopped", "error"].includes(message.status) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Publication interrupted
                      </p>
                    )}
                  </article>
                  {snapshot.deliveries
                    .filter(
                      (delivery) =>
                        delivery.messageId === message.id &&
                        delivery.state === "error",
                    )
                    .map((delivery) => {
                      const agent = snapshot.agents.find(
                        (entry) => entry.id === delivery.agentId,
                      );
                      return (
                        <article
                          key={delivery.id}
                          className="rounded-xl border border-border bg-surface-recessed p-4"
                          data-room-failure={delivery.id}
                        >
                          <strong className="text-sm">
                            {agent?.name ?? "Agent"} couldn’t complete this
                            request
                          </strong>
                          <p className="my-3 text-sm">
                            {delivery.error ||
                              "No failure details were reported."}
                          </p>
                          {agent && (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setText((draft) =>
                                    draft.trim() ? draft : message.text,
                                  );
                                  setRecipients([agent.id]);
                                  setSteering(null);
                                  composer.current?.focus();
                                }}
                              >
                                Ask {agent.name} again
                              </Button>
                              {session.access.operator && (
                                <ThreadLink agent={agent} />
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                </Fragment>
              ))}
              {snapshot.deliveries
                .filter((delivery) => activeStates.has(delivery.state))
                .map((delivery) => {
                  const agent = snapshot.agents.find(
                    (entry) => entry.id === delivery.agentId,
                  );
                  const input = pendingInput.get(delivery.agentId);
                  const awaitingInput =
                    delivery.state === "running" && input?.data;
                  return (
                    <div
                      key={delivery.id}
                      role="status"
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          name={
                            delivery.state === "uncertain" || awaitingInput
                              ? "AlertCircle"
                              : "Spinner"
                          }
                          className={
                            delivery.state === "uncertain" || awaitingInput
                              ? ""
                              : "animate-spin"
                          }
                        />
                        <strong>{agent?.name ?? "Agent"}</strong>
                        <span>
                          {delivery.state === "queued"
                            ? "Waiting"
                            : delivery.state === "uncertain"
                              ? "Needs attention"
                              : awaitingInput
                                ? "Awaiting input"
                                : delivery.intent === "notice"
                                  ? "Considering the conversation"
                                  : "Working on your request"}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {Math.max(
                            0,
                            Math.floor(
                              (now -
                                (delivery.startedAt ?? delivery.createdAt)) /
                                1000,
                            ),
                          )}
                          s
                        </span>
                      </div>
                      {delivery.error && (
                        <p className="mt-2">{delivery.error}</p>
                      )}
                      {input?.error && (
                        <p className="mt-2" role="alert">
                          Input status unavailable: {input.error.message}. Open
                          the thread to inspect it.
                        </p>
                      )}
                      {agent && session.access.operator && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {delivery.state === "running" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSteering(agent);
                                setRecipients([agent.id]);
                                composer.current?.focus();
                              }}
                            >
                              Steer now
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void perform(async () => {
                                await roomsRequest(
                                  `${roomPath(roomId)}/agents/${agent.id}/stop`,
                                  {},
                                );
                              })
                            }
                          >
                            Stop
                          </Button>
                          {delivery.state === "uncertain" && owner && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void perform(async () => {
                                  await roomsRequest(
                                    `${roomPath(roomId)}/agents/${agent.id}/recover`,
                                    {},
                                  );
                                })
                              }
                            >
                              Resolve interrupted dispatch
                            </Button>
                          )}
                          {session.access.operator && (
                            <ThreadLink agent={agent} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              <div ref={end} />
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 pt-2">
            {status && (
              <p className="mb-2 text-xs text-muted-foreground" role="status">
                {status}
              </p>
            )}
            <form
              onSubmit={(event) => void send(event)}
              className="relative space-y-2 rounded-xl border border-input bg-background p-3"
            >
              {steering && (
                <div className="flex items-center justify-between text-sm">
                  <span>Input for {steering.name}’s active turn</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setSteering(null)}
                  >
                    Cancel steering
                  </Button>
                </div>
              )}
              {!!recipients.length && (
                <div
                  className="flex flex-wrap gap-2"
                  aria-label="Selected recipients"
                >
                  {recipients.map((id) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-label={`Remove ${participants.find((person) => person.id === id)?.name} recipient`}
                      onClick={() =>
                        setRecipients((current) =>
                          current.filter((entry) => entry !== id),
                        )
                      }
                    >
                      {participants.find((person) => person.id === id)?.name}
                      <Icon name="X" />
                    </Button>
                  ))}
                </div>
              )}
              {mention !== null && (
                <div
                  role="listbox"
                  aria-label="Choose a participant"
                  className="absolute bottom-full left-0 z-10 mb-2 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-background p-2 shadow-lg"
                >
                  {options.map((person) => (
                    <Button
                      type="button"
                      role="option"
                      aria-selected={recipients.includes(person.id)}
                      key={person.id}
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => selectRecipient(person)}
                    >
                      <Icon name={person.agent ? "Bot" : "UserRound"} />
                      {person.name}
                      <span className="text-muted-foreground">
                        @{person.handle}
                      </span>
                    </Button>
                  ))}
                  {!options.length && (
                    <p className="p-2 text-sm">No matching participant</p>
                  )}
                </div>
              )}
              <Textarea
                ref={composer}
                value={text}
                maxLength={16000}
                aria-label="Message the room"
                placeholder="Message the room… use @ to ask someone"
                className="min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                onChange={(event) => {
                  setText(event.target.value);
                  const match = event.target.value.match(/(?:^|\s)@([\w-]*)$/);
                  setMention(match?.[1] ?? null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setMention(null);
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (mention !== null && options[0])
                      selectRecipient(options[0]);
                    else void send();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="Choose participants"
                    onClick={() => setMention(mention === null ? "" : null)}
                  >
                    @
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {snapshot.room.paused
                      ? "New agent turns are paused"
                      : recipients.length
                        ? "Ask selected participants; everyone follows along"
                        : "Everyone follows along; reply when useful"}
                  </span>
                </div>
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send message"
                  disabled={!text.trim() || sending}
                >
                  <Icon
                    name={sending ? "Spinner" : "ArrowUp"}
                    className={sending ? "animate-spin" : ""}
                  />
                </Button>
              </div>
            </form>
          </div>
        </>
      )}
      <RoomDrawer
        open={panel === "create"}
        title="Create room"
        close={() => setPanel(null)}
      >
        <form
          key={createFormVersion}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void perform(async () => {
              const room = roomsRoomSchema.parse(
                await roomsRequest("/rooms", {
                  name: String(data.get("name")),
                  ...readRoomContext(data),
                }),
              );
              await refreshSession();
              setCreateFormVersion((current) => current + 1);
              setPanel(null);
              void navigate(roomPath(room.id));
            });
          }}
        >
          <label className={fieldClass}>
            Room name
            <Input
              name="name"
              required
              maxLength={100}
              placeholder="Design review"
            />
          </label>
          {session?.access.operator && <RoomContextFields />}
          <p className="text-sm text-muted-foreground">
            A room shares a conversation. Agent work stays in BB projects,
            environments and threads.
          </p>
          <Button type="submit">Create room</Button>
        </form>
      </RoomDrawer>
      <RoomDrawer
        open={panel === "people"}
        title="Room participants"
        close={() => setPanel(null)}
      >
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>Signed in as {session?.user.name}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void perform(async () => {
                await roomsRequest("/logout", {});
                location.assign("/rooms");
              })
            }
          >
            Sign out
          </Button>
        </div>
        {snapshot && (
          <>
            <div className="space-y-3">
              {snapshot.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <Icon name="UserRound" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground">
                      @{member.handle} · {member.role}
                      {snapshot.online.includes(member.id) ? " · Online" : ""}
                    </p>
                  </div>
                  {owner && member.id !== session?.user.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void perform(async () => {
                          await roomsRequest(
                            `${roomPath(snapshot.room.id)}/members/${member.id}`,
                            undefined,
                            "DELETE",
                          );
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {snapshot.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="space-y-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="Bot" />
                    <div>
                      <p className="text-sm font-medium">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">
                        @{agent.handle} · {agent.provider} · {agent.status}
                      </p>
                    </div>
                  </div>
                  {session?.access.operator && <ThreadLink agent={agent} />}
                </div>
              ))}
            </div>
            {owner && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    void perform(async () => {
                      const result = z
                        .object({ invite: z.string() })
                        .parse(
                          await roomsRequest(
                            `${roomPath(snapshot.room.id)}/invites`,
                            {},
                          ),
                        );
                      setInviteUrl(
                        `${location.origin}/rooms#invite=${encodeURIComponent(result.invite)}`,
                      );
                    })
                  }
                >
                  Create invitation
                </Button>
                {inviteUrl && (
                  <label className={fieldClass}>
                    Invitation link
                    <Input
                      readOnly
                      value={inviteUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                )}
                {session?.access.operator && (
                  <Button onClick={() => setPanel("agent")}>Add agent</Button>
                )}
              </>
            )}
          </>
        )}
      </RoomDrawer>
      <RoomDrawer
        open={panel === "agent"}
        title="Add agent"
        close={() => setPanel(null)}
      >
        <RoomAgentForm
          canOperate={session?.access.operator ?? false}
          hasProject={Boolean(snapshot?.room.projectId)}
          submit={async (body) => {
            if (!roomId) return;
            await roomsRequest(`${roomPath(roomId)}/agents`, body);
            setPanel(null);
          }}
        />
      </RoomDrawer>
      <RoomDrawer
        open={panel === "controls"}
        title="Room controls"
        close={() => setPanel(null)}
      >
        {snapshot && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const budget = String(data.get("budget")).trim();
              void perform(async () => {
                if (session?.access.operator)
                  await roomsRequest(
                    `${roomPath(snapshot.room.id)}/context`,
                    readRoomContext(data),
                    "PUT",
                  );
                await roomsRequest(
                  `${roomPath(snapshot.room.id)}/policy`,
                  {
                    paused: data.get("paused") === "on",
                    maxActivations: budget ? Number(budget) : null,
                  },
                  "PUT",
                );
                await refreshSession();
                setPanel(null);
              });
            }}
          >
            {session?.access.operator && (
              <RoomContextFields
                projectId={snapshot.room.projectId}
                environmentId={snapshot.room.defaultEnvironmentId}
                sectionId={snapshot.room.sectionId}
              />
            )}
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="paused"
                defaultChecked={snapshot.room.paused}
              />
              Pause new agent turns
            </label>
            <label className={fieldClass}>
              Agent turn budget
              <Input
                name="budget"
                type="number"
                min={1}
                max={100000}
                defaultValue={snapshot.room.maxActivations ?? ""}
                placeholder="Unlimited"
              />
            </label>
            <p className="text-sm text-muted-foreground">
              {snapshot.room.activationsUsed} turns used. Reaching a budget
              pauses new turns visibly.
            </p>
            <Button type="submit">Save controls</Button>
          </form>
        )}
      </RoomDrawer>
    </section>
  );
}
