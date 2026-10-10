import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const repo = process.env.ROOMS_TEST_REPO;
const data = process.env.ROOMS_TEST_DATA;
const origin = process.env.ROOMS_TEST_ORIGIN;
const evidence = process.env.ROOMS_TEST_EVIDENCE;
if (!repo?.startsWith("/Users/admin/") || !data?.startsWith("/Users/admin/") || !origin || !evidence)
  throw new Error("Explicit disposable VM repo/data, public origin, and evidence directory required");
const require = createRequire(`${repo}/apps/rooms/package.json`);
const { chromium, expect } = require("@playwright/test");
const { RoomsStore } = await import(pathToFileURL(`${repo}/apps/rooms/src/store.ts`).href);
const store = new RoomsStore(`${data}/rooms.sqlite`);
const stamp = Date.now().toString(36);
const room = store.createRoom(`Room-wide routing regression ${stamp}`, "");
const invite = store.invite(room.id, "owner");
store.close();
await mkdir(evidence, { recursive: true });
await writeFile(`${evidence}/fixture.json`, JSON.stringify({ roomId: room.id, roomName: room.name }, null, 2));
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all([browser.newContext({ viewport: { width: 1440, height: 1000 } }), browser.newContext({ viewport: { width: 1280, height: 900 } })]);
const [owner, member] = await Promise.all(contexts.map((context) => context.newPage()));
const password = crypto.randomUUID() + "aA1";
const errors = [];
const claims = [];
const observations = [];
const configurations = [
  { name: "Atlas", handle: "atlas", provider: "codex", model: "gpt-6.1-sol", instructions: "Bring a thoughtful, practical perspective. Participate in the room as yourself." },
  { name: "Nova", handle: "nova", provider: "claude-code", model: "claude-opus-5-5", instructions: "Bring an imaginative, questioning perspective. Participate in the room as yourself." },
];
const prompts = [];
let stage = "setup";
for (const page of [owner, member]) page.on("pageerror", (error) => errors.push(error.message));
async function snapshot() {
  const response = await contexts[0].request.get(`${origin}/api/rooms/${room.id}`);
  expect(response.status()).toBe(200);
  return response.json();
}
async function register(page, invitation, name) {
  await page.goto(`${origin}/#invite=${encodeURIComponent(invitation)}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Handle", { exact: true }).fill(`${name.toLowerCase()}_${stamp}`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Join the room", exact: true }).click();
  await expect(page.getByLabel("Message the room")).toBeVisible();
  await expect(page.getByRole("heading", { name: room.name, exact: true })).toBeVisible();
}
try {
  await register(owner, invite, "Avery");
  await owner.getByRole("button", { name: /People/ }).click();
  await owner.getByRole("button", { name: "Create invitation", exact: true }).click();
  const invitationUrl = await owner.getByLabel("One-time invitation").inputValue();
  const memberInvite = new URLSearchParams(new URL(invitationUrl).hash.slice(1)).get("invite");
  if (!memberInvite) throw new Error("No member invitation");
  await owner.getByLabel("Close panel").click();
  await register(member, memberInvite, "Morgan");
  const humans = (await snapshot()).members;
  expect(new Set(humans.map((human) => human.id)).size).toBe(2);
  claims.push("Two independently authenticated humans joined the isolated room through invitations");
  for (const config of configurations) {
    await owner.getByRole("button", { name: "＋ Add agent", exact: true }).click();
    await owner.getByLabel("Name", { exact: true }).fill(config.name);
    await owner.getByLabel("Handle", { exact: true }).fill(config.handle);
    await owner.getByRole("dialog").locator("select[name=provider]").selectOption(config.provider);
    await owner.locator("input[name=model]").fill(config.model);
    await owner.getByLabel("Instructions", { exact: true }).fill(config.instructions);
    await owner.getByRole("button", { name: "Add agent", exact: true }).click();
    await expect(owner.locator(".participant").filter({ hasText: config.name })).toBeVisible();
  }
  const agents = (await snapshot()).agents;
  const atlas = agents.find((agent) => agent.handle === "atlas");
  const nova = agents.find((agent) => agent.handle === "nova");
  async function send(page, text, target = null) {
    if (target) {
      await page.getByLabel("Message the room").fill(`@${target.handle}`);
      await page.getByRole("option", { name: new RegExp(target.name) }).click();
      await expect(page.getByLabel("Message intent")).toHaveValue("request");
    } else await page.getByLabel("Message intent").selectOption("post");
    prompts.push({ stage, text, target: target?.handle ?? null });
    await page.getByLabel("Message the room").fill(text);
    await page.getByLabel("Send message", { exact: true }).click();
    await expect(page.getByLabel("Message the room")).toHaveValue("");
    const value = await snapshot();
    const message = value.messages.find((item) => item.text === text && item.kind === "human");
    expect(message).toBeDefined();
    await writeFile(`${evidence}/prompts.json`, JSON.stringify(prompts, null, 2));
    return message;
  }
  async function settle(inspect = null) {
    const deadline = Date.now() + 300000;
    let quietSince = null;
    while (Date.now() < deadline) {
      const value = await snapshot();
      if (inspect) await inspect(value);
      const state = value.deliveries.map((delivery) => ({ id: delivery.id, messageId: delivery.messageId, agentId: delivery.agentId, intent: delivery.intent, state: delivery.state, outcome: delivery.outcome, error: delivery.error }));
      if (JSON.stringify(observations.at(-1)?.deliveries) !== JSON.stringify(state)) {
        observations.push({ stage, at: new Date().toISOString(), deliveries: state });
        await writeFile(`${evidence}/observations.json`, JSON.stringify(observations, null, 2));
      }
      if (await owner.locator(".approval").count()) throw new Error("Provider approval needs scoped owner review");
      const failed = value.deliveries.find((delivery) => ["error", "uncertain", "stopped"].includes(delivery.state));
      if (failed) throw new Error(`Agent ${failed.state}: ${failed.error}`);
      const quiet = value.deliveries.every((delivery) => delivery.state === "complete");
      if (quiet) quietSince ??= Date.now();
      else quietSince = null;
      if (quietSince && Date.now() - quietSince >= 1500) return value;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Room failed to become quiescent during ${stage}`);
  }
  async function visible(message) {
    const texts = [];
    for (const page of [owner, member]) {
      const bubble = page.locator(`article[data-message-id="${message.id}"]`);
      await expect(bubble).toHaveAttribute("data-author-id", message.authorId);
      await expect(bubble).toHaveAttribute("data-status", "complete");
      texts.push(await bubble.locator(".prose").innerText());
    }
    expect(texts[0]).toBe(texts[1]);
  }
  async function checkpoint(claim, value) {
    claims.push(claim);
    await writeFile(`${evidence}/${stage}.json`, JSON.stringify(value, null, 2));
    await writeFile(`${evidence}/checkpoint.json`, JSON.stringify({ roomId: room.id, stage, claims }, null, 2));
    console.log("PASS", claim);
  }
  stage = "unaddressed-open-question";
  const open = await send(owner, "We're planning a shared task board for a two-person team. What is one essential feature, and why?");
  let value = await settle();
  for (const agent of agents) {
    const delivery = value.deliveries.find((item) => item.messageId === open.id && item.agentId === agent.id);
    expect(delivery?.intent).toBe("notice");
    expect(delivery?.outcome).toBe("replied");
    const answer = value.messages.find((item) => item.authorId === agent.id && item.causeId === open.id);
    expect(answer?.text.length).toBeGreaterThan(30);
    await visible(answer);
  }
  await checkpoint("Unaddressed human question reached both agents as optional notices; each independently contributed in both human browsers", value);
  stage = "peer-open-question";
  const questionRequest = await send(member, "@atlas Please ask the whole room one open question about handling blocked tasks. Nova, wait for Atlas's question and then offer your perspective. Keep this a brief discussion.", atlas);
  value = await settle();
  expect(value.deliveries.find((item) => item.messageId === questionRequest.id && item.agentId === atlas.id)?.intent).toBe("request");
  expect(value.deliveries.find((item) => item.messageId === questionRequest.id && item.agentId === nova.id)?.intent).toBe("notice");
  const question = value.messages.find((item) => item.authorId === atlas.id && item.causeId === questionRequest.id && item.text.includes("?") && item.recipients.length === 0);
  expect(question).toBeDefined();
  const peerDelivery = value.deliveries.filter((item) => item.messageId === question.id && item.agentId === nova.id);
  expect(peerDelivery).toHaveLength(1);
  expect(peerDelivery[0].intent).toBe("notice");
  expect(peerDelivery[0].outcome).toBe("replied");
  expect(value.deliveries.some((item) => item.messageId === question.id && item.agentId === atlas.id)).toBe(false);
  const peerAnswer = value.messages.find((item) => item.authorId === nova.id && item.causeId === question.id);
  expect(peerAnswer?.text.length).toBeGreaterThan(30);
  await visible(question);
  await visible(peerAnswer);
  await checkpoint("Targeted request remained request for Atlas and optional notice for Nova; Atlas's recipient-free question reached Nova once, produced her own answer, and did not wake Atlas itself", value);
  stage = "stream-commit";
  for (const page of [owner, member]) await page.evaluate((authorId) => {
    const output = document.createElement("script");
    output.id = "routing-stream-observer";
    output.type = "application/json";
    output.textContent = "[]";
    document.body.append(output);
    const previous = new Set(Array.from(document.querySelectorAll("article[data-message-id]"), (node) => node.getAttribute("data-message-id")));
    const states = [];
    new MutationObserver(() => {
      for (const node of document.querySelectorAll("article[data-message-id]")) {
        const id = node.getAttribute("data-message-id");
        if (previous.has(id) || node.getAttribute("data-author-id") !== authorId) continue;
        const entry = { id, status: node.getAttribute("data-status"), text: node.querySelector(".prose")?.textContent ?? "" };
        if (!states.some((state) => state.id === entry.id && state.status === entry.status && state.text === entry.text)) states.push(entry);
      }
      output.textContent = JSON.stringify(states);
    }).observe(document.getElementById("root"), { childList: true, subtree: true, characterData: true, attributes: true });
  }, atlas.id);
  const streaming = await send(owner, "@atlas Please compose one short three-paragraph proposal for our board, showing each paragraph in the same public message as you develop it so we can watch the draft grow. Nova, wait until the proposal is complete, then offer one brief improvement. No further discussion is needed after that.", atlas);
  const streamedIds = new Set();
  let streamSnapshots = 0;
  value = await settle(async (current) => {
    for (const message of current.messages.filter((item) => item.authorId === atlas.id && item.causeId === streaming.id && item.status === "streaming")) {
      streamedIds.add(message.id);
      streamSnapshots++;
      expect(current.deliveries.filter((item) => item.messageId === message.id)).toHaveLength(0);
    }
  });
  expect(streamSnapshots).toBeGreaterThan(0);
  expect(streamedIds.size).toBe(1);
  const streamId = [...streamedIds][0];
  const stream = value.messages.find((message) => message.id === streamId);
  expect(stream.status).toBe("complete");
  const afterCommit = value.deliveries.filter((delivery) => delivery.messageId === streamId);
  expect(afterCommit).toHaveLength(1);
  expect(afterCommit[0].agentId).toBe(nova.id);
  expect(afterCommit[0].intent).toBe("notice");
  const streamObservers = [];
  for (const page of [owner, member]) {
    const states = JSON.parse(await page.locator("#routing-stream-observer").textContent());
    expect(new Set(states.filter((item) => item.id === streamId && item.status === "streaming" && item.text !== "…").map((item) => item.text)).size).toBeGreaterThanOrEqual(2);
    expect(states.some((item) => item.id === streamId && item.status === "complete")).toBe(true);
    streamObservers.push(states);
  }
  await writeFile(`${evidence}/stream-observers.json`, JSON.stringify(streamObservers, null, 2));
  await checkpoint("Both browsers observed naturally authored public stream growth; incomplete chunks scheduled nobody and final commit scheduled exactly one peer notice", value);
  stage = "closing-silence";
  const beforeClosing = new Set(value.messages.map((message) => message.id));
  const closing = await send(member, "Thanks, we have what we need. This topic is closed; no further replies are needed.");
  value = await settle();
  expect(value.messages.filter((message) => !beforeClosing.has(message.id) && message.kind === "agent")).toHaveLength(0);
  for (const agent of agents) {
    const delivery = value.deliveries.find((item) => item.messageId === closing.id && item.agentId === agent.id);
    expect(delivery?.intent).toBe("notice");
    expect(delivery?.outcome).toBe("no_reply");
  }
  await checkpoint("Both agents processed an unaddressed closing notice without public posts and the whole room became quiescent", value);
  expect(errors).toEqual([]);
  await owner.screenshot({ path: `${evidence}/owner.png`, fullPage: true });
  await member.screenshot({ path: `${evidence}/member.png`, fullPage: true });
  await writeFile(`${evidence}/result.json`, JSON.stringify({ origin, roomId: room.id, prompts, claims, errors, completed: new Date().toISOString() }, null, 2));
} catch (error) {
  await writeFile(`${evidence}/failure.json`, JSON.stringify({ roomId: room.id, stage, prompts, claims, errors, error: String(error) }, null, 2));
  await writeFile(`${evidence}/failure-snapshot.json`, JSON.stringify(await snapshot(), null, 2)).catch(() => {});
  await owner.screenshot({ path: `${evidence}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  for (const context of contexts) await context.request.post(`${origin}/api/logout`, { headers: { "X-Rooms-Request": "1" } }).catch(() => {});
  await browser.close();
}
