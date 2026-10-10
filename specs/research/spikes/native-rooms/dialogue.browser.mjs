import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../../../../apps/rooms/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const fixture = JSON.parse(await readFile(process.env.ROOMS_NATIVE_QA_FIXTURE, "utf8"));
const output = process.env.ROOMS_NATIVE_QA_OUTPUT;
assert(output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all([browser.newContext({ viewport: { width: 1440, height: 1000 } }), browser.newContext({ viewport: { width: 1280, height: 900 } })]);
const pages = await Promise.all(contexts.map((context) => context.newPage()));
const evidence = { startedAt: new Date().toISOString(), steps: [], errors: [] };
const secrets = [fixture.operator.password, fixture.operator2.password];
const clean = (text) => secrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), String(text));
let room;
async function record(step, data = {}) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...data });
  await writeFile(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ step, at: new Date().toISOString() }));
}
async function api(index, path, body) {
  const response = await contexts[index].request.fetch(fixture.url + "/api" + path, { method: body ? "POST" : "GET", headers: { "X-Rooms-Request": "1", Origin: fixture.url }, ...(body ? { data: body } : {}) });
  assert(response.ok(), `${path}: HTTP ${response.status()} ${clean(await response.text())}`);
  return response.json();
}
async function snapshot() { return api(0, `/rooms/${room.id}/poll`); }
async function until(description, check, timeout = 300000) {
  const deadline = Date.now() + timeout;
  let lastProgress = 0;
  while (Date.now() < deadline) {
    const state = await snapshot();
    const failed = state.deliveries.find((delivery) => ["error", "uncertain"].includes(delivery.state));
    assert(!failed, failed?.error ?? "Delivery failed");
    if (await check(state)) return state;
    if (Date.now() - lastProgress > 15000) {
      console.log(JSON.stringify({ waiting: description, publicMessages: state.messages.length, active: state.deliveries.filter((delivery) => !["complete", "stopped"].includes(delivery.state)).length }));
      lastProgress = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out: ${description}`);
}
async function settled(description) {
  return until(description, (state) => state.deliveries.every((delivery) => ["complete", "stopped"].includes(delivery.state)));
}
async function send(index, text, names = []) {
  const page = pages[index];
  await page.getByRole("textbox", { name: "Message the room", exact: true }).fill(text);
  for (const name of names) {
    await page.getByRole("button", { name: "Choose participants", exact: true }).click();
    await page.getByRole("option", { name: new RegExp(name) }).click();
  }
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message the room", exact: true })).toHaveValue("");
}
try {
  for (const [index, page] of pages.entries()) {
    page.on("pageerror", (error) => evidence.errors.push({ index, message: clean(error.message) }));
    await page.addInitScript(() => {
      window.roomObservations = [];
      const Original = window.EventSource;
      window.EventSource = class extends Original {
        constructor(...args) {
          super(...args);
          this.addEventListener("snapshot", (event) => {
            const state = JSON.parse(event.data);
            window.roomObservations.push({ at: Date.now(), revision: state.room.revision, messages: state.messages.map(({ id, authorId, kind, status, text }) => ({ id, authorId, kind, status, text })) });
          });
        }
      };
    });
    await page.goto(fixture.url + "/rooms");
    const account = index === 0 ? fixture.operator : fixture.operator2;
    await expect(page.getByRole("heading", { name: "Sign in to BB" })).toBeVisible();
    await page.getByLabel("Handle", { exact: true }).fill(account.handle);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const setup = page.getByRole("button", { name: "Skip setup", exact: true });
    await expect(page.getByRole("heading", { name: "Rooms", exact: true }).or(setup)).toBeVisible({ timeout: 30000 });
    if (await setup.isVisible()) {
      await setup.click();
      await page.goto(fixture.url + "/rooms");
    }
    await expect(page.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible({ timeout: 30000 });
  }
  room = await api(0, "/rooms", { name: `Native dialogue ${Date.now().toString(36)}`, projectId: fixture.projectId, defaultEnvironmentId: null, sectionId: null });
  await record("Created isolated dialogue fixture", { roomId: room.id });
  const invitation = await api(0, `/rooms/${room.id}/invites`, {});
  secrets.push(invitation.invite);
  await api(1, "/join", { invite: invitation.invite });
  await Promise.all(pages.map((page) => page.goto(fixture.url + "/rooms/" + room.id)));
  await Promise.all(pages.map((page) => expect(page.getByRole("heading", { name: room.name })).toBeVisible()));
  for (const [name, handle, provider] of [["Atlas", "atlas", "codex"], ["Nova", "nova", "claude-code"]]) {
    await pages[0].getByRole("button", { name: "Add agent", exact: true }).click();
    await pages[0].getByLabel("Name", { exact: true }).fill(name);
    await pages[0].getByLabel("Handle", { exact: true }).fill(handle);
    await pages[0].getByRole("combobox", { name: /^Provider/ }).selectOption(provider);
    await pages[0].locator("form").getByRole("button", { name: "Add agent", exact: true }).click();
    await expect(pages[0].getByRole("combobox", { name: /^Provider/ })).toHaveCount(0);
  }
  await record("Two separately signed-in humans share native BB room; agents added through native UI", { roomId: room.id });
  const first = "Atlas and Nova, each share your own perspective on what makes a meaningful life in two sentences. Use your public room command. Do not speak for the other participant.";
  await send(0, first, ["Atlas", "Nova"]);
  await expect(pages[1].locator("article").filter({ hasText: first })).toHaveCount(1);
  await until("Both independent agents publish", (state) => state.agents.every((agent) => state.messages.some((message) => message.kind === "agent" && message.authorId === agent.id)));
  const initial = await settled("Initial conversation settles");
  await record("Both BB-managed providers independently publish; general topics work", { agents: initial.agents.map(({ id, provider, threadId, projectId, environmentId }) => ({ id, provider, threadId, projectId, environmentId })), messages: initial.messages, deliveries: initial.deliveries });
  const before = initial.messages.length;
  await send(1, "A question for the room: should a shared task board record the next concrete action or just a broad goal? Please offer a useful answer if you have one; do not repeat another answer.");
  const aware = await until("Optional open question receives a useful answer", (state) => state.messages.slice(before + 1).some((message) => message.kind === "agent"));
  const optional = aware.deliveries.filter((delivery) => delivery.messageId === aware.messages[before].id);
  assert.equal(optional.length, 2);
  assert(optional.every((delivery) => delivery.intent !== "request"));
  await settled("Optional room awareness settles");
  await record("Second human's undirected question reaches both agents; they choose public participation", { deliveries: optional });
  const streamStart = (await snapshot()).messages.map((message) => message.id);
  await send(0, "Each independently share three short paragraphs explaining your perspective on a useful shared task board. Publish incrementally: use the supplied room CLI stream begin, append paragraph one with sequence 0, wait two seconds, append paragraph two with sequence 1, wait two seconds, append paragraph three with sequence 2, then stream commit. Compose each paragraph as you go. Use the returned stream message ID, never the incoming message ID. Do not duplicate your answer with a separate post. End your turn after committing.", ["Atlas", "Nova"]);
  await until("Visible incremental publication", async (state) => {
    const partial = state.messages.find((message) => !streamStart.includes(message.id) && message.kind === "agent" && message.status === "streaming" && message.text.length > 20);
    if (!partial) return false;
    for (const [index, page] of pages.entries()) {
      await expect(page.locator("article").filter({ hasText: partial.text.slice(0, 35) }).first()).toBeVisible();
      await page.screenshot({ path: join(output, `streaming-human-${index + 1}.png`), fullPage: true });
    }
    return true;
  });
  const streamed = await settled("Both public streams commit and peer deliveries settle");
  const observers = await Promise.all(pages.map((page) => page.evaluate(() => window.roomObservations)));
  const streams = streamed.messages.filter((message) => !streamStart.includes(message.id) && message.kind === "agent");
  for (const agent of streamed.agents) {
    const owned = streams.filter((message) => message.authorId === agent.id);
    assert(owned.some((message) => observers.every((observations) => new Set(observations.flatMap((observation) => observation.messages.filter((item) => item.id === message.id && item.status === "streaming" && item.text.length > 0).map((item) => item.text))).size >= 2)), `Both humans must observe at least two partial updates from ${agent.name}`);
  }
  await writeFile(join(output, "stream-observers.json"), JSON.stringify(observers, null, 2));
  await record("Both agents stream independent public messages to both human browsers", { streams });
  await send(1, "Thanks, that resolves this discussion. No response is needed; please remain silent unless there is a material unresolved issue.");
  const quiet = await settled("Agents choose silence");
  const finalHuman = quiet.messages.filter((message) => message.kind === "human").at(-1);
  assert(finalHuman);
  const silence = quiet.deliveries.filter((delivery) => delivery.messageId === finalHuman.id);
  assert.equal(silence.length, 2);
  assert(silence.every((delivery) => delivery.outcome === "no_reply"));
  for (const [index, page] of pages.entries()) {
    await page.reload();
    await expect(page.getByRole("heading", { name: room.name })).toBeVisible();
    await page.screenshot({ path: join(output, `final-human-${index + 1}.png`), fullPage: true });
  }
  await record("Silence produces no public chatter; history survives both browser reloads", { silence });
  assert.deepEqual(evidence.errors, []);
  evidence.passed = true;
} catch (error) {
  evidence.failure = clean(error.stack ?? error);
  throw error;
} finally {
  await writeFile(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
