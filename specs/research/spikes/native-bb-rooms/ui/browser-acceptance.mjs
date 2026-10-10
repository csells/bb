import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(new URL("../../../../../apps/rooms/package.json", import.meta.url));
const { chromium, webkit, expect } = require("@playwright/test");
const fixture = JSON.parse(await readFile(process.env.ROOMS_NATIVE_QA_FIXTURE, "utf8"));
const output = process.env.ROOMS_NATIVE_QA_OUTPUT;
if (!output) throw new Error("ROOMS_NATIVE_QA_OUTPUT is required");
await mkdir(output, { recursive: true });
const stamp = Date.now().toString(36);
const roomName = `Native room ${stamp}`;
const sectionName = `Native section ${stamp}`;
const privateValues = new Set([fixture.operator.password, fixture.guest.password]);
function sanitize(value) {
  let result = String(value);
  for (const secret of privateValues) if (secret) result = result.replaceAll(secret, "[redacted]");
  return result;
}
const engine = process.env.ROOMS_NATIVE_QA_ENGINE === "webkit" ? "webkit" : "chromium";
const browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const operator = await operatorContext.newPage();
const guest = await guestContext.newPage();
const pageErrors = [];
const requests = { operator: [], guest: [] };
const steps = [];
let roomUrl;
for (const [name, page] of [["operator", operator], ["guest", guest]]) {
  page.on("pageerror", (error) => pageErrors.push({ page: name, message: sanitize(error.message) }));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) requests[name].push({ method: request.method(), path: url.pathname });
  });
}
async function passed(name) {
  steps.push(name);
  console.log(JSON.stringify({ passed: name }));
  await writeFile(path.join(output, "steps.json"), JSON.stringify(steps, null, 2));
}
async function login(page, account) {
  await expect(page.getByLabel("Handle", { exact: true })).toBeVisible();
  await page.getByLabel("Handle", { exact: true }).fill(account.handle);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const setup = page.getByRole("button", { name: "Skip setup", exact: true });
  await expect(page.getByRole("heading", { name: "Rooms", exact: true }).or(setup)).toBeVisible({ timeout: 30000 });
  if (await setup.isVisible()) {
    await setup.click();
    await page.goto(new URL("/rooms", fixture.url).href);
  }
  if (process.env.ROOMS_NATIVE_QA_INSPECT === "1") {
    await expect(page.getByLabel("Handle", { exact: true })).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    return;
  }
  await expect(page.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible({ timeout: 30000 });
}
async function drawerKeepsRootAvailable(page) {
  expect(await page.locator("#root").evaluate((root) => ({ inert: root.inert, hidden: root.getAttribute("aria-hidden") }))).toEqual({ inert: false, hidden: null });
}
try {
  await operator.goto(new URL("/rooms", fixture.url).href);
  await expect(operator.getByRole("heading", { name: "Sign in to BB" })).toBeVisible();
  expect(requests.operator.filter((request) => request.path.startsWith("/api/v1/") && request.path !== "/api/v1/rooms/session")).toEqual([]);
  await passed("Anonymous login does not initialize private BB APIs");
  await login(operator, fixture.operator);
  await operator.screenshot({ path: path.join(output, "01-native-room-index.png"), fullPage: true });
  if (process.env.ROOMS_NATIVE_QA_INSPECT === "1") {
    await writeFile(path.join(output, "initial-visible-text.txt"), sanitize(await operator.locator("body").innerText()));
    await passed("Inspection checkpoint reached");
  } else {
    await operator.getByRole("button", { name: "New room", exact: true }).click();
    await expect(operator.getByLabel("Room name", { exact: true })).toBeVisible();
    await drawerKeepsRootAvailable(operator);
    await operator.getByLabel("Room name", { exact: true }).fill(roomName);
    await operator.getByRole("combobox", { name: /^Project/ }).selectOption(fixture.projectId);
    if (fixture.environmentId) await operator.getByRole("combobox", { name: /^Environment/ }).selectOption(fixture.environmentId);
    await operator.getByRole("button", { name: "New section", exact: true }).click();
    await operator.getByLabel("New section name").fill(sectionName);
    await operator.getByRole("button", { name: "Add section", exact: true }).click();
    await expect(operator.getByRole("combobox", { name: /^Section/ }).locator("option:checked")).toHaveText(sectionName);
    await operator.screenshot({ path: path.join(output, "02-create-room-native-context.png"), fullPage: true });
    await operator.getByRole("dialog", { name: "Create room", exact: true }).getByRole("button", { name: "Create room", exact: true }).click();
    await expect(operator.getByRole("heading", { name: roomName, exact: true })).toBeVisible();
    roomUrl = operator.url();
    await expect(operator.getByText(sectionName, { exact: true }).first()).toBeVisible();
    await expect(operator.getByRole("status").filter({ hasText: "Live" }).first()).toBeVisible();
    await passed("Operator creates room in a real BB project and newly created section");

    await operator.getByRole("button", { name: "Room participants", exact: true }).click();
    await operator.getByRole("button", { name: "Create invitation", exact: true }).click();
    const invitation = await operator.getByLabel("Invitation link", { exact: true }).inputValue();
    privateValues.add(new URLSearchParams(new URL(invitation).hash.slice(1)).get("invite"));
    await operator.getByRole("button", { name: "Close Room participants", exact: true }).click();
    await guest.goto(invitation);
    await guest.getByRole("button", { name: "Already have an account? Sign in", exact: true }).click();
    await login(guest, fixture.guest);
    await guest.getByRole("link", { name: roomName, exact: true }).click();
    await expect(guest.getByRole("heading", { name: roomName, exact: true })).toBeVisible();
    await passed("Separate human identity joins through a one-time browser invitation");

    const operatorMessage = `Operator greeting ${stamp}`;
    const guestMessage = `Guest greeting ${stamp}`;
    await operator.getByRole("textbox", { name: "Message the room", exact: true }).fill(operatorMessage);
    await operator.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(guest.locator("article").filter({ hasText: operatorMessage })).toHaveCount(1);
    await guest.getByRole("textbox", { name: "Message the room", exact: true }).fill(guestMessage);
    await guest.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(operator.locator("article").filter({ hasText: guestMessage })).toHaveCount(1);
    await guest.reload();
    await expect(guest.locator("article").filter({ hasText: operatorMessage })).toHaveCount(1);
    await expect(guest.locator("article").filter({ hasText: guestMessage })).toHaveCount(1);
    const operatorAuthor = await guest.locator("article").filter({ hasText: operatorMessage }).locator("strong").first().innerText();
    const guestAuthor = await guest.locator("article").filter({ hasText: guestMessage }).locator("strong").first().innerText();
    expect(operatorAuthor).not.toBe(guestAuthor);
    expect(requests.guest.filter((request) => request.path.startsWith("/api/v1/") && request.path !== "/api/v1/rooms/session")).toEqual([]);
    await expect(guest.getByRole("button", { name: "Add agent", exact: true })).toHaveCount(0);
    await passed("Both identities exchange live persisted messages; guest never boots private BB APIs");
    await operator.screenshot({ path: path.join(output, "03-two-human-room.png"), fullPage: true });

    if (fixture.existingThreadId) {
      await operator.getByRole("button", { name: "Add agent", exact: true }).click();
      await operator.getByRole("combobox", { name: /^Agent conversation/ }).selectOption("existing");
      await operator.getByLabel("Name", { exact: true }).fill(`Attached ${stamp}`);
      await operator.getByLabel("Handle", { exact: true }).fill(`attached_${stamp}`);
      await operator.getByRole("combobox", { name: /^BB thread/ }).selectOption(fixture.existingThreadId);
      await operator.getByRole("dialog", { name: "Add agent", exact: true }).getByRole("button", { name: "Add agent", exact: true }).click();
      await operator.getByRole("button", { name: "Room participants", exact: true }).click();
      await operator.getByRole("link", { name: `Open Attached ${stamp}’s thread` }).click();
      await expect(operator).toHaveURL(new RegExp(`/threads/${fixture.existingThreadId}`));
      await operator.screenshot({ path: path.join(output, "04-real-bb-thread.png"), fullPage: true });
      await writeFile(path.join(output, "native-thread-visible-text.txt"), sanitize(await operator.locator("body").innerText()));
      await passed("Existing agent opens its actual BB thread in the native workspace");
      await operator.goto(roomUrl);
    }

    await operator.setViewportSize({ width: 390, height: 844 });
    await expect(operator.getByRole("button", { name: "New room", exact: true })).toBeVisible();
    await operator.getByRole("button", { name: "New room", exact: true }).click();
    await expect(operator.getByLabel("Room name", { exact: true })).toBeVisible();
    await drawerKeepsRootAvailable(operator);
    const compactDrawer = operator.getByRole("dialog", { name: "Create room", exact: true });
    await expect(operator.getByLabel("Room name", { exact: true })).toHaveValue("");
    await expect(operator.getByRole("combobox", { name: /^Project/ })).toHaveValue("");
    await expect.poll(() => compactDrawer.evaluate((panel) => new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42)).toBe(0);
    const compactPanel = await compactDrawer.elementHandle();
    await operator.screenshot({ path: path.join(output, "05-compact-room-drawer.png"), fullPage: true });
    await operator.getByRole("button", { name: "Close Create room", exact: true }).click();
    await expect.poll(() => compactPanel.evaluate((panel) => panel.getBoundingClientRect().top >= innerHeight - 1)).toBe(true);
    expect(await operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await operator.screenshot({ path: path.join(output, "06-compact-room.png"), fullPage: true });
    await passed("Compact room creation remains reachable without hiding or disabling the app root");
    expect(pageErrors).toEqual([]);
    await writeFile(path.join(output, "result.json"), JSON.stringify({ ok: true, engine, roomUrl, roomName, sectionName, steps, pageErrors, requests }, null, 2));
  }
} catch (error) {
  for (const [name, page] of [["operator", operator], ["guest", guest]]) {
    await page.screenshot({ path: path.join(output, `failure-${name}.png`), fullPage: true, mask: [page.locator('input[type="password"]')] });
    await writeFile(path.join(output, `failure-${name}-visible-text.txt`), sanitize(await page.locator("body").innerText()));
  }
  await writeFile(path.join(output, "failure.json"), JSON.stringify({ ok: false, error: sanitize(error.stack ?? error), steps, pageErrors, requests }, null, 2));
  console.error(sanitize(error.stack ?? error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
