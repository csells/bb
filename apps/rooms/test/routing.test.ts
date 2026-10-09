import { describe, it, expect } from "vitest";
import { recipients } from "../src/routing.js";
const agents = [
  { id: "a", handle: "claude" },
  { id: "b", handle: "codex" },
];
describe("room addressing", () => {
  it("fans a prompt out exactly once to each named agent", () =>
    expect(
      recipients("@Claude and @codex, collaborate. @Claude", agents, null),
    ).toEqual(["a", "b"]));
  it("does not confuse a human mention with an unaddressed prompt", () =>
    expect(recipients("@chris please read", agents, "a")).toEqual([]));
  it("uses the selected default only for unaddressed prompts", () =>
    expect(recipients("hello", agents, "b")).toEqual(["b"]));
  it("never routes partial names or email addresses", () =>
    expect(recipients("foo@claude.com @codex-extra", agents, null)).toEqual(
      [],
    ));
});
