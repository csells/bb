// @vitest-environment jsdom
import { useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomsSessionGate } from "./RoomsSessionGate";
import { appQueryClient } from "@/lib/app-query-client";
import { wsManager } from "@/lib/ws";

vi.mock("./RoomsView", () => ({
  RoomsView: function RoomsView() {
    const [draft, setDraft] = useState("");
    return (
      <div>
        Shared conversation
        <input
          aria-label="Room draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    );
  },
}));
const user = { id: "human-a", handle: "alice", name: "Alice" };
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountOperatorProbe() {
  const bootstrap = vi.fn();
  function OperatorApp() {
    useEffect(bootstrap, []);
    const [draft, setDraft] = useState("");
    return (
      <div>
        Operator workspace
        <input
          aria-label="Operator draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    );
  }
  render(
    <MemoryRouter initialEntries={["/rooms"]}>
      <RoomsSessionGate>
        <OperatorApp />
      </RoomsSessionGate>
    </MemoryRouter>,
  );
  return bootstrap;
}

describe("native Rooms session boundary", () => {
  it.each([
    {
      identity: "anonymous",
      user: null,
      operator: false,
      visible: "Sign in to BB",
    },
    {
      identity: "guest",
      user,
      operator: false,
      visible: "Shared conversation",
    },
    {
      identity: "operator",
      user,
      operator: true,
      visible: "Operator workspace",
    },
  ])(
    "only an authenticated operator starts BB bootstrap ($identity)",
    async (entry) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                enabled: true,
                user: entry.user,
                access: { operator: entry.operator },
              }),
              { status: 200 },
            ),
        ),
      );
      const bootstrap = mountOperatorProbe();
      await screen.findByText(entry.visible);
      expect(bootstrap).toHaveBeenCalledTimes(entry.operator ? 1 : 0);
    },
  );
  it("does not grant operator access while session discovery is failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unavailable", { status: 503 })),
    );
    const bootstrap = mountOperatorProbe();
    await screen.findByRole("alert");
    expect(bootstrap).not.toHaveBeenCalled();
    expect(screen.queryByText("Operator workspace")).toBeNull();
  });
  it("preserves ordinary BB installations without the native gateway", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );
    const bootstrap = mountOperatorProbe();
    await waitFor(() => expect(bootstrap).toHaveBeenCalledOnce());
    expect(screen.getByText("Operator workspace")).toBeTruthy();
  });
  it("unmounts the operator workspace when its authenticated session is revoked", async () => {
    let authenticated = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              enabled: true,
              user: authenticated ? user : null,
              access: { operator: authenticated },
            }),
            { status: 200 },
          ),
      ),
    );
    const bootstrap = mountOperatorProbe();
    await waitFor(() => expect(bootstrap).toHaveBeenCalledOnce());
    authenticated = false;
    await screen.findByText("Sign in to BB", {}, { timeout: 7000 });
    expect(screen.queryByText("Operator workspace")).toBeNull();
  });
  it.each([false, true])(
    "clears cached and mounted private state before changing account (operator: %s)",
    async (operator) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      let currentUser = user;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                enabled: true,
                user: currentUser,
                access: { operator },
              }),
            ),
        ),
      );
      const disconnect = vi.spyOn(wsManager, "disconnect");
      const bootstrap = mountOperatorProbe();
      const label = operator ? "Operator draft" : "Room draft";
      const draft = await screen.findByRole("textbox", { name: label });
      appQueryClient.setQueryData(["rooms", "index"], {
        rooms: [{ name: "Alice private room" }],
      });
      fireEvent.change(draft, { target: { value: "Alice private draft" } });
      disconnect.mockClear();
      currentUser = { id: "human-b", handle: "bob", name: "Bob" };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(appQueryClient.getQueryData(["rooms", "index"])).toBeUndefined();
      expect(
        screen.getByRole("textbox", { name: label }).getAttribute("value"),
      ).toBe("");
      expect(disconnect).toHaveBeenCalledOnce();
      expect(bootstrap).toHaveBeenCalledTimes(operator ? 2 : 0);
    },
  );
});
