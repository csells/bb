// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { makePluginProject, makeSidebarThread } from "../model/fixtures.js";
import { preferencesReadyAtom } from "../preferences/preferences-sync.js";
import { sidebarOrganizationModeAtom } from "../preferences/atoms.js";

installTestPluginRuntime();
const { ProjectList } = await import("./ProjectList.js");
const { resetSidebarDataCacheForTest } =
  await import("../model/use-sidebar-data.js");

afterEach(() => {
  cleanup();
  resetSidebarDataCacheForTest();
});

function Harness({
  children,
  store,
}: {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}) {
  return (
    <TooltipProvider>
      <Provider store={store}>{children}</Provider>
    </TooltipProvider>
  );
}

it.each(["chronological", "project"] as const)(
  "keeps rooms alongside native thread navigation in %s mode",
  (mode) => {
    const store = createStore();
    store.set(preferencesReadyAtom(), true);
    store.set(sidebarOrganizationModeAtom, mode);
    const project = makePluginProject();
    renderSlot(
      { component: Harness },
      { children: <ProjectList activeThreadId={null} />, store },
      {
        sidebarThreads: {
          projects: [project],
          threads: [
            makeSidebarThread({
              sectionId: "sec_a",
              title: "Independent thread",
            }),
          ],
          sections: [
            { id: "sec_a", name: "Design", createdAt: 1, updatedAt: 1 },
          ],
          experimental_rooms: {
            status: "ready",
            error: null,
            items: [
              {
                id: "room_a",
                name: "Shared design",
                href: "/rooms/room_a",
                projectId: project.id,
                sectionId: "sec_a",
              },
              {
                id: "room_b",
                name: "Open discussion",
                href: "/rooms/room_b",
                projectId: project.id,
                sectionId: null,
              },
            ],
          },
        },
      },
    );
    expect(
      screen
        .getByRole("link", { name: "Shared design Room" })
        .getAttribute("href"),
    ).toBe("/rooms/room_a");
    expect(
      screen
        .getByRole("link", { name: "Open discussion Room" })
        .getAttribute("href"),
    ).toBe("/rooms/room_b");
    expect(screen.getByText("Independent thread")).toBeTruthy();
  },
);
