import { chromium, expect } from "@playwright/test";
import { RoomsStore } from "../src/store.js";
import { mkdir } from "node:fs/promises";
const origin = process.env.ROOMS_TEST_ORIGIN ?? "http://127.0.0.1:38900";
const data = process.env.ROOMS_DATA_DIR ?? "/Users/admin/rooms-data";
const stamp = Date.now().toString(36);
const store = new RoomsStore(data + "/rooms.sqlite");
const room = store.createRoom("Acceptance " + stamp, "");
const invite = store.invite(room.id, "owner");
store.close();
const browser = await chromium.launch({ headless: true });
const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  b = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const alex = await a.newPage(),
  blair = await b.newPage();
const errors: string[] = [];
for (const page of [alex, blair])
  page.on("pageerror", (e) => errors.push(e.message));
const password = crypto.randomUUID() + "A1";
async function register(
  page: typeof alex,
  inv: string,
  name: string,
  handle: string,
) {
  await page.goto(origin + "/#invite=" + inv);
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Handle", { exact: true }).fill(handle);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Join the room", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: room.name, exact: true }),
  ).toBeVisible();
}
try {
  await register(alex, invite, "Alex QA", "alex_" + stamp);
  console.log("[1/8] Owner registration through the browser passed");
  await alex.getByRole("button", { name: /People/ }).click();
  await alex
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const guestLink = await alex.locator(".panel input[readonly]").inputValue();
  await alex.getByLabel("Close panel").click();
  await register(
    blair,
    new URLSearchParams(new URL(guestLink).hash.slice(1)).get("invite")!,
    "Blair QA",
    "blair_" + stamp,
  );
  console.log(
    "[2/8] One-time invitation and separate second-human session passed",
  );
  await alex.getByLabel("Message the room").fill("Hello from Alex " + stamp);
  await alex.getByLabel("Send message").click();
  await expect(blair.locator('article[data-author="Alex QA"]')).toContainText(
    "Hello from Alex",
  );
  await blair.getByLabel("Message the room").fill("Hello from Blair " + stamp);
  await blair.getByLabel("Send message").click();
  await expect(alex.locator('article[data-author="Blair QA"]')).toContainText(
    "Hello from Blair",
  );
  console.log(
    "[3/8] Both humans see each other’s live messages with distinct authors",
  );
  await Promise.all([
    alex.getByLabel("Message the room").fill("Concurrent Alex " + stamp),
    blair.getByLabel("Message the room").fill("Concurrent Blair " + stamp),
  ]);
  await Promise.all([
    alex.getByLabel("Send message").click(),
    blair.getByLabel("Send message").click(),
  ]);
  for (const page of [alex, blair]) {
    await expect(page.locator("article")).toHaveCount(4);
    await expect(page.locator(".conversation")).toContainText(
      "Concurrent Alex",
    );
    await expect(page.locator(".conversation")).toContainText(
      "Concurrent Blair",
    );
  }
  console.log("[4/8] Concurrent sends retained exactly once in both browsers");
  await blair.reload();
  await expect(blair.locator("article")).toHaveCount(4);
  console.log("[5/8] Reload reconstructs the persisted conversation");
  const unauth = await browser.newContext();
  expect(
    (await unauth.request.get(origin + "/api/rooms/" + room.id)).status(),
  ).toBe(401);
  await unauth.close();
  const forged = await a.request.post(
    origin + "/api/rooms/" + room.id + "/messages",
    {
      headers: { "X-Rooms-Request": "1" },
      data: {
        text: "forged",
        requestId: crypto.randomUUID(),
        authorId: "someone-else",
      },
    },
  );
  expect(forged.status()).toBe(400);
  console.log("[6/8] Anonymous reads and forged attribution rejected");
  await alex.getByRole("button", { name: /People/ }).click();
  await alex
    .locator(".member")
    .filter({ hasText: "Blair QA" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(blair.getByRole("alert")).toContainText("not a member");
  await alex.getByLabel("Close panel").click();
  console.log("[7/8] Membership revocation closes access in the other browser");
  await mkdir(data + "/evidence", { recursive: true });
  await alex.screenshot({
    path: data + "/evidence/humans-desktop.png",
    fullPage: true,
  });
  await alex.setViewportSize({ width: 390, height: 844 });
  await alex.screenshot({
    path: data + "/evidence/humans-mobile.png",
    fullPage: true,
  });
  expect(
    await alex.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  console.log(
    "[8/8] Desktop/mobile render, no horizontal overflow or browser exceptions",
  );
  console.log("PASS human browser acceptance", room.id);
} finally {
  await browser.close();
}
