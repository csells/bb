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
const room = store.createRoom(`Room-wide steering regression ${stamp}`, "");
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
const prompt = "@atlas For a controlled live-input check, run the shell command sleep 20 before publishing one short observation about teamwork. A human may supply new information while the tool runs; incorporate it. Nova, this is an observation-only control check for you: do not post anything in response to this task or its follow-up.";
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
  const { createNodeBbSdk } = require("@bb/sdk");
  const sdk = createNodeBbSdk({ baseUrl: "http://127.0.0.1:38886" });
  const atlas = (await snapshot()).agents.find((agent) => agent.handle === "atlas");
  const nova = (await snapshot()).agents.find((agent) => agent.handle === "nova");
  await owner.getByLabel("Message the room").fill("@atlas");
  await owner.getByRole("option", { name: /Atlas/ }).click();
  await owner.getByLabel("Message the room").fill(prompt);
  await owner.getByLabel("Send message", { exact: true }).click();
  await expect(owner.getByLabel("Message the room")).toHaveValue("");
  const initial = (await snapshot()).messages.find((message) => message.text === prompt);
  let originalDelivery;
  let pendingWork;
  const flatten = (rows) => rows.flatMap((row) => [row, ...flatten(row.children ?? [])]);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const current = await snapshot();
    const agent = current.agents.find((item) => item.id === atlas.id);
    if (agent.threadId) {
      const timeline = await sdk.threads.timeline({ threadId: agent.threadId, includeNestedRows: "true", segmentLimit: "20" });
      const work = flatten(timeline.rows).find((row) => row.kind === "work" && row.status === "pending" && row.command?.includes("sleep 20"));
      if (work) {
        originalDelivery = current.deliveries.find((delivery) => delivery.messageId === initial.id && delivery.agentId === atlas.id);
        expect(originalDelivery.state).toBe("running");
        const thread = await sdk.threads.get({ threadId: agent.threadId });
        expect(thread.status).toBe("active");
        pendingWork = { threadId: agent.threadId, workId: work.id, command: work.command, status: work.status, observedAt: new Date().toISOString(), activationId: originalDelivery.activationId };
        break;
      }
    }
    const failed = current.deliveries.find((delivery) => ["error", "uncertain"].includes(delivery.state));
    if (failed) throw new Error(`Initial fixture failed: ${failed.error}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(pendingWork).toBeDefined();
  await writeFile(`${evidence}/pending-work.json`, JSON.stringify(pendingWork, null, 2));
  const marker = `STEERING_OBSERVED_${stamp}`;
  const steerText = `New information for Atlas: our team's shared goal is restoring the lighthouse. Include ${marker} in your public observation so we can confirm this input reached your current work. Nova, continue observing silently; no reply is needed.`;
  const response = await contexts[1].request.post(`${origin}/api/rooms/${room.id}/agents/${atlas.id}/steer`, { headers: { "X-Rooms-Request": "1" }, data: { text: steerText } });
  const receipt = await response.json();
  await writeFile(`${evidence}/steering-receipt.json`, JSON.stringify({ status: response.status(), receipt, at: new Date().toISOString() }, null, 2));
  expect(response.status()).toBe(200);
  expect(receipt.accepted).toBe(true);
  expect(receipt.delivery).toBe("sent");
  let final;
  let quietSince = null;
  const completionDeadline = Date.now() + 180000;
  while (Date.now() < completionDeadline) {
    final = await snapshot();
    const failure = final.deliveries.find((delivery) => ["error", "uncertain", "stopped"].includes(delivery.state));
    if (failure) throw new Error(`Steering fixture failed: ${failure.state}: ${failure.error}`);
    const quiet = final.deliveries.every((delivery) => delivery.state === "complete");
    if (quiet) quietSince ??= Date.now(); else quietSince = null;
    if (quietSince && Date.now() - quietSince >= 1500) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  expect(final.deliveries.every((delivery) => delivery.state === "complete")).toBe(true);
  const steeringMessage = final.messages.find((message) => message.kind === "human" && message.text === steerText);
  expect(steeringMessage).toBeDefined();
  expect(steeringMessage.recipients).toEqual([atlas.id]);
  const routed = final.deliveries.filter((delivery) => delivery.messageId === steeringMessage.id);
  expect(routed).toHaveLength(1);
  expect(routed[0].agentId).toBe(nova.id);
  expect(routed[0].intent).toBe("notice");
  expect(routed[0].outcome).toBe("no_reply");
  const atlasDeliveries = final.deliveries.filter((delivery) => delivery.agentId === atlas.id);
  expect(atlasDeliveries).toHaveLength(1);
  expect(atlasDeliveries[0].activationId).toBe(originalDelivery.activationId);
  const effect = final.messages.find((message) => message.authorId === atlas.id && message.text.includes(marker));
  expect(effect).toBeDefined();
  expect(effect.causeId).toBe(initial.id);
  for (const page of [owner, member]) {
    await expect(page.locator(`article[data-message-id="${steeringMessage.id}"] .prose`)).toContainText(marker);
    await expect(page.locator(`article[data-message-id="${effect.id}"]`)).toHaveAttribute("data-author-id", atlas.id);
    await expect(page.locator(`article[data-message-id="${effect.id}"] .prose`)).toContainText(marker);
  }
  expect(errors).toEqual([]);
  claims.push("Second human native steering was accepted as sent during a real pending Atlas tool and its effect appeared in Atlas's original activation");
  claims.push("Steering publication addressed Atlas without creating a second Atlas delivery; Nova received exactly one optional notice and stayed silent");
  claims.push("Both humans observed the steering input and independently attributed agent effect; all work settled without duplicate target activation");
  await writeFile(`${evidence}/snapshot.json`, JSON.stringify(final, null, 2));
  await owner.screenshot({ path: `${evidence}/owner.png`, fullPage: true });
  await member.screenshot({ path: `${evidence}/member.png`, fullPage: true });
  await writeFile(`${evidence}/result.json`, JSON.stringify({ mode: "controlled native steering lifecycle", origin, roomId: room.id, prompt, steerText, claims, errors, completed: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ roomId: room.id, claims, errors }));
} catch (error) {
  await writeFile(`${evidence}/failure.json`, JSON.stringify({ roomId: room.id, prompt, claims, errors, error: String(error) }, null, 2));
  await writeFile(`${evidence}/snapshot.json`, JSON.stringify(await snapshot(), null, 2)).catch(() => {});
  await owner.screenshot({ path: `${evidence}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  for (const context of contexts) await context.request.post(`${origin}/api/logout`, { headers: { "X-Rooms-Request": "1" } }).catch(() => {});
  await browser.close();
}
