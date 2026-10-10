// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Environment } from "@bb/domain";
import { makeEnvironment } from "@bb/test-helpers/domain-fixtures";
import { sdk } from "@/lib/sdk";
import { RoomContextFields, readRoomContext } from "./RoomContextFields";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: { list: vi.fn() },
    threadSections: { list: vi.fn() },
    environments: { list: vi.fn() },
  },
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("preserves the saved environment while options load and clears it only when the project changes", async () => {
  vi.mocked(sdk.projects.list).mockResolvedValue([
    {
      id: "project-a",
      name: "Project A",
      kind: "standard",
      gitRemoteUrl: null,
      sources: [],
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "project-b",
      name: "Project B",
      kind: "standard",
      gitRemoteUrl: null,
      sources: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
  vi.mocked(sdk.threadSections.list).mockResolvedValue([]);
  let resolveEnvironments!: (value: Environment[]) => void;
  const environments = new Promise<Environment[]>((resolve) => {
    resolveEnvironments = resolve;
  });
  vi.mocked(sdk.environments.list)
    .mockReturnValueOnce(environments)
    .mockResolvedValue([]);
  render(
    <form aria-label="Room controls">
      <RoomContextFields projectId="project-a" environmentId="environment-a" />
    </form>,
  );
  await screen.findByRole("option", { name: "Project A" });
  const form = screen.getByRole<HTMLFormElement>("form", {
    name: "Room controls",
  });
  expect(readRoomContext(new FormData(form)).defaultEnvironmentId).toBe(
    "environment-a",
  );
  await act(async () => {
    resolveEnvironments([
      makeEnvironment({
        id: "environment-a",
        projectId: "project-a",
        name: "Existing environment",
      }),
    ]);
  });
  expect(readRoomContext(new FormData(form)).defaultEnvironmentId).toBe(
    "environment-a",
  );
  fireEvent.change(screen.getByLabelText("Project"), {
    target: { value: "project-b" },
  });
  expect(readRoomContext(new FormData(form))).toEqual({
    projectId: "project-b",
    defaultEnvironmentId: null,
    sectionId: null,
  });
});
