import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomsStore } from "../src/store.js";
import { RoomRuntime } from "../src/runtime.js";
const stores: RoomsStore[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of directories.splice(0))
    rmSync(d, { recursive: true, force: true });
});
it("refreshes an existing agent workspace with the current room delivery rules before dispatch", async () => {
  const workspaces = mkdtempSync(join(tmpdir(), "rooms-instructions-"));
  directories.push(workspaces);
  const store = new RoomsStore(":memory:");
  stores.push(store);
  const room = store.createRoom("Instructions", "");
  const owner = store.register(
    store.invite(room.id, "owner"),
    "owner",
    "Owner",
    "correct horse battery",
  );
  const agent = store.addAgent(room.id, {
    handle: "builder",
    name: "Builder",
    provider: "pi",
    model: "local/model",
    instructions: "",
  });
  store.saveAgent({ ...store.agent(agent.id), projectId: "existing-project" });
  const workspace = join(workspaces, room.id, agent.id);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    join(workspace, "AGENTS.md"),
    "# Room participation\n\nA plain post does not wake other agents.\n",
  );
  store.sendHuman(
    owner,
    room.id,
    { text: "Thoughts?", intent: "post", recipients: [], replyTo: null },
    crypto.randomUUID(),
  );
  const runtime = new RoomRuntime(store, "http://127.0.0.1:1", workspaces);
  await runtime.run(store.work()[0]).catch(() => undefined);
  const instructions = readFileSync(join(workspace, "AGENTS.md"), "utf8");
  expect(instructions).not.toContain("does not wake");
  expect(instructions).toContain(
    "Every completed public human or agent message is delivered to every other agent once",
  );
});
