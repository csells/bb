// @vitest-environment jsdom
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { RoomsSnapshot } from "@bb/domain";
import { NativeRoomsContext } from "@/lib/native-rooms-context";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { RoomsView } from "./RoomsView";

vi.mock("@/components/layout/AppPageHeader", () => ({
  AppPageHeader: ({
    center,
    actions,
  }: {
    center: ReactNode;
    actions: ReactNode;
  }) => (
    <header>
      {center}
      {actions}
    </header>
  ),
}));
vi.mock("@/components/ui/markdown-preview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

class RoomEvents extends EventTarget {
  static streams: RoomEvents[] = [];
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    super();
    RoomEvents.streams.push(this);
  }
  close() {}
  snapshot(value: RoomsSnapshot) {
    this.dispatchEvent(
      new MessageEvent("snapshot", { data: JSON.stringify(value) }),
    );
  }
}

const user = { id: "human-a", name: "Alice", handle: "alice" };
function snapshot(id = "room-a"): RoomsSnapshot {
  return {
    room: {
      id,
      name: id === "room-a" ? "Design room" : "Planning room",
      ownerId: user.id,
      projectId: null,
      defaultEnvironmentId: null,
      sectionId: null,
      revision: 1,
      paused: false,
      pauseReason: null,
      maxActivations: null,
      activationsUsed: 0,
    },
    members: [{ ...user, role: "owner" }],
    agents: [
      {
        id: "nova",
        roomId: id,
        handle: "nova",
        name: "Nova",
        provider: "claude-code",
        model: "",
        instructions: "",
        projectId: "project-a",
        environmentId: "environment-a",
        threadId: "thread-a",
        status: "working",
      },
    ],
    messages: [],
    deliveries: [],
    online: [user.id],
  };
}
function runningSnapshot(): RoomsSnapshot {
  const room = snapshot();
  room.deliveries.push({
    id: "delivery-a",
    roomId: room.room.id,
    agentId: "nova",
    messageId: "message-a",
    state: "running",
    error: null,
    createdAt: Date.now(),
    startedAt: Date.now(),
    intent: "request",
    activationId: "activation-a",
    threadId: "thread-a",
    outcome: null,
  });
  return room;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function mount(
  handler: (path: string, init?: RequestInit) => Promise<Response>,
  operator = true,
) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/me")
      return json({
        user,
        rooms: [snapshot().room, snapshot("room-b").room],
        access: { operator },
      });
    return handler(path, init);
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("EventSource", RoomEvents);
  const harness = createQueryClientTestHarness();
  const router = createMemoryRouter(
    [{ path: "/rooms/:roomId", element: <RoomsView /> }],
    { initialEntries: ["/rooms/room-a"] },
  );
  render(
    <NativeRoomsContext value={true}>
      <RouterProvider router={router} />
    </NativeRoomsContext>,
    { wrapper: harness.wrapper },
  );
  return { router, fetch };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  RoomEvents.streams = [];
});

it("clears recovered connection errors, retains action errors, and drops errors when changing rooms", async () => {
  let disconnected = true;
  const { router } = mount(async (path) => {
    if (path.endsWith("/poll"))
      return disconnected
        ? json({ error: "Room connection interrupted" }, 503)
        : json(snapshot(path.includes("room-b") ? "room-b" : "room-a"));
    if (path.endsWith("/messages"))
      return json({ error: "Message was rejected" }, 409);
    throw new Error(`Unexpected request ${path}`);
  });
  await screen.findByText("Room connection interrupted");
  disconnected = false;
  act(() => RoomEvents.streams[0]!.snapshot(snapshot()));
  expect(screen.queryByText("Room connection interrupted")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Message the room" }), {
    target: { value: "A message" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Message was rejected");
  act(() =>
    RoomEvents.streams[0]!.snapshot({
      ...snapshot(),
      room: { ...snapshot().room, revision: 2 },
    }),
  );
  expect(screen.getByText("Message was rejected")).toBeTruthy();
  await act(async () => {
    await router.navigate("/rooms/room-b");
  });
  await screen.findByRole("heading", { name: "Planning room" });
  expect(screen.queryByText("Message was rejected")).toBeNull();
});

it("shows pending native input to the operator and returns to working when it is resolved", async () => {
  let pending = true;
  mount(async (path) => {
    if (path.endsWith("/poll")) return json(runningSnapshot());
    if (path.endsWith("/interactions"))
      return json(
        pending
          ? [
              {
                id: "permission-a",
                status: "pending",
                payload: { secret: "Private shell approval" },
              },
            ]
          : [],
      );
    throw new Error(`Unexpected request ${path}`);
  });
  await within(await screen.findByTestId("room-history")).findByText(
    "Awaiting input",
  );
  expect(screen.getByRole("link", { name: "Open Nova’s thread" })).toBeTruthy();
  expect(screen.queryByText("Private shell approval")).toBeNull();
  pending = false;
  await screen.findByText("Working on your request", {}, { timeout: 4000 });
  expect(screen.queryByText("Awaiting input")).toBeNull();
});

it("never requests private interaction details for a guest who owns a room", async () => {
  const { fetch } = mount(async (path) => {
    if (path.endsWith("/poll")) return json(runningSnapshot());
    throw new Error(`Unexpected private request ${path}`);
  }, false);
  await screen.findByText("Working on your request");
  expect(screen.queryByRole("link", { name: "Open Nova’s thread" })).toBeNull();
  expect(
    fetch.mock.calls.some(([path]) => String(path).includes("/interactions")),
  ).toBe(false);
});

it.each([false, true])(
  "preserves a newer draft when an earlier send completes (different room: %s)",
  async (navigate) => {
    let resolveSend!: (value: Response) => void;
    const sent = new Promise<Response>((resolve) => {
      resolveSend = resolve;
    });
    const { router, fetch } = mount(async (path) => {
      if (path.endsWith("/poll"))
        return json(snapshot(path.includes("room-b") ? "room-b" : "room-a"));
      if (path.endsWith("/messages")) return sent;
      throw new Error(`Unexpected request ${path}`);
    });
    const composer = await screen.findByRole("textbox", {
      name: "Message the room",
    });
    fireEvent.change(composer, { target: { value: "First message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([path]) => String(path).endsWith("/messages")),
      ).toBe(true),
    );
    if (navigate) {
      await act(async () => {
        await router.navigate("/rooms/room-b");
      });
      await screen.findByRole("heading", { name: "Planning room" });
    }
    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the room" }),
      { target: { value: "Keep this new draft" } },
    );
    await act(async () => {
      resolveSend(json({ accepted: true }));
    });
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Message the room",
      }).value,
    ).toBe("Keep this new draft");
  },
);
