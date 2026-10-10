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
const room = store.createRoom(`Task board regression ${stamp}`, "");
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
const prompt = "@atlas @nova Propose a plan for a shared task board. Each share your own perspective.";
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
  await owner.getByLabel("Message the room").fill("@atlas");
  await owner.getByRole("option", { name: /Atlas/ }).click();
  await owner.getByLabel("Message the room").press("End");
  await owner.getByLabel("Message the room").pressSequentially("@nova");
  await owner.getByRole("option", { name: /Nova/ }).click();
  await expect(owner.getByLabel("Selected recipients")).toContainText("Atlas");
  await expect(owner.getByLabel("Selected recipients")).toContainText("Nova");
  await expect(owner.getByLabel("Message intent")).toHaveValue("request");
  await owner.getByLabel("Message the room").fill(prompt);
  await owner.getByLabel("Send message", { exact: true }).click();
  await expect(owner.getByLabel("Message the room")).toHaveValue("");
  await expect(member.locator('article[data-author="Avery"]')).toContainText(prompt);
  const deadline = Date.now() + 300000;
  let current;
  while (Date.now() < deadline) {
    current = await snapshot();
    const state = current.deliveries.map((delivery) => ({ id: delivery.id, agentId: delivery.agentId, state: delivery.state, error: delivery.error }));
    if (JSON.stringify(observations.at(-1)?.deliveries) !== JSON.stringify(state)) {
      observations.push({ at: new Date().toISOString(), deliveries: state });
      await writeFile(`${evidence}/observations.json`, JSON.stringify(observations, null, 2));
    }
    if (await owner.locator(".approval").count()) throw new Error("Provider requests owner approval; retain evidence for scoped review");
    const failure = current.deliveries.find((delivery) => ["error", "uncertain", "stopped"].includes(delivery.state));
    if (failure) throw new Error(`Agent failed: ${failure.state}: ${failure.error}`);
    if (current.deliveries.length >= 2 && current.deliveries.every((delivery) => delivery.state === "complete")) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(current.deliveries.length).toBeGreaterThanOrEqual(2);
  expect(current.deliveries.every((delivery) => delivery.state === "complete")).toBe(true);
  const authors = [];
  for (const config of configurations) {
    const agent = current.agents.find((item) => item.handle === config.handle);
    expect(agent.provider).toBe(config.provider);
    expect(agent.model).toBe(config.model);
    authors.push(agent.id);
    const posts = current.messages.filter((message) => message.authorId === agent.id && message.kind === "agent" && message.status === "complete");
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts.some((message) => message.text.length > 80)).toBe(true);
    for (const post of posts) {
      const rendered = [];
      for (const page of [owner, member]) {
        const bubble = page.locator(`article[data-message-id="${post.id}"]`);
        await expect(bubble).toHaveAttribute("data-author", config.name);
        await expect(bubble).toHaveAttribute("data-status", "complete");
        await expect(bubble.locator(".prose")).not.toBeEmpty();
        rendered.push(await bubble.locator(".prose").innerText());
      }
      expect(rendered[0]).toBe(rendered[1]);
    }
    claims.push(`${config.name} published an independently authored substantive response visible in both human browsers`);
  }
  expect(new Set(authors).size).toBe(2);
  expect(errors).toEqual([]);
  await writeFile(`${evidence}/snapshot.json`, JSON.stringify(current, null, 2));
  await owner.screenshot({ path: `${evidence}/owner.png`, fullPage: true });
  await member.screenshot({ path: `${evidence}/member.png`, fullPage: true });
  await writeFile(`${evidence}/result.json`, JSON.stringify({ origin, roomId: room.id, prompt, claims, errors, completed: new Date().toISOString() }, null, 2));
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
