import { chromium, expect, type Page } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  roomsRoomSchema,
  roomsSnapshotSchema,
  type RoomsSnapshot,
} from "@bb/domain";

const origin = process.env.ROOMS_TEST_ORIGIN;
const inviteFile = process.env.ROOMS_TEST_INVITE_FILE;
const evidenceDirectory = process.env.ROOMS_TEST_EVIDENCE;
const provider = process.env.ROOMS_TEST_PROVIDER ?? "pi";
const model =
  process.env.ROOMS_TEST_MODEL ?? "rooms-local/qwen3:4b-instruct-2507-q4_K_M";
if (!origin || !inviteFile || !evidenceDirectory)
  throw new Error(
    "Set ROOMS_TEST_ORIGIN, ROOMS_TEST_INVITE_FILE and ROOMS_TEST_EVIDENCE to isolated candidate resources",
  );
const invitation = (await readFile(inviteFile, "utf8")).trim();
const stamp = Date.now().toString(36);
const password = crypto.randomUUID() + "aA1";
const claims: string[] = [];
function recordClaim(claim: string) {
  claims.push(claim);
  console.log("PASS", claim);
}
const failures: string[] = [];
const browser = await chromium.launch({ headless: true });
const first = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const second = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const alex = await first.newPage();
const blair = await second.newPage();
for (const page of [alex, blair])
  page.on("pageerror", (error) => failures.push(error.message));
let roomId = "";
let roomName = "";
async function register(page: Page, invite: string, name: string) {
  await page.goto(`${origin}/#invite=${encodeURIComponent(invite)}`);
  await page.getByLabel("Your name").fill(name);
  await page
    .getByLabel("Handle", { exact: true })
    .fill(name.toLowerCase() + "_" + stamp);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Join the room", exact: true })
    .click();
  await expect(page.getByLabel("Message the room")).toBeVisible();
}
async function snapshot(context = first): Promise<RoomsSnapshot> {
  const response = await context.request.get(`${origin}/api/rooms/${roomId}`);
  expect(response.status()).toBe(200);
  return roomsSnapshotSchema.parse(await response.json());
}
async function send(page: Page, text: string) {
  await page.getByLabel("Message the room").fill(text);
  await page.getByLabel("Send message", { exact: true }).click();
  await expect(page.getByLabel("Message the room")).toHaveValue("");
}
async function selectMention(page: Page, handle: string, name: string) {
  await page.getByLabel("Message the room").fill(`@${handle}`);
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByLabel("Selected recipients")).toContainText(name);
}
async function settle(previous: RoomsSnapshot["deliveries"] = []) {
  const existingIds = new Set(previous.map((delivery) => delivery.id));
  await expect
    .poll(
      async () => {
        const value = await snapshot();
        const current = value.deliveries.filter(
          (delivery) => !existingIds.has(delivery.id),
        );
        const failed = current.find(
          (item) => item.state === "error" || item.state === "uncertain",
        );
        if (failed)
          throw new Error(`Agent delivery ${failed.state}: ${failed.error}`);
        return (
          current.length > 0 &&
          value.deliveries.every(
            (item) =>
              !["queued", "dispatching", "running"].includes(item.state),
          )
        );
      },
      { timeout: 300000, intervals: [500, 1000, 1500] },
    )
    .toBe(true);
}
async function assertShellUsable(page: Page) {
  expect(
    await page
      .locator("#root")
      .evaluate(
        (node) =>
          node.hasAttribute("inert") ||
          node.getAttribute("aria-hidden") === "true",
      ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
  ).toBe(false);
}

try {
  await mkdir(evidenceDirectory, { recursive: true });
  await register(alex, invitation, "Alex");
  roomName = "Shared room acceptance " + stamp;
  await alex.getByLabel("Create room", { exact: true }).click();
  await alex.getByLabel("Room name", { exact: true }).fill(roomName);
  await alex
    .getByRole("dialog")
    .getByRole("button", { name: "Create room", exact: true })
    .click();
  await expect(
    alex.getByRole("heading", { name: roomName, exact: true }),
  ).toBeVisible();
  const mine = await first.request.get(`${origin}/api/me`);
  const mineBody = z
    .object({ rooms: z.array(roomsRoomSchema) })
    .parse(await mine.json());
  const match = mineBody.rooms.find((entry) => entry.name === roomName);
  if (!match || typeof match.id !== "string")
    throw new Error("Owner room missing from authenticated response");
  roomId = match.id;
  await alex.getByRole("button", { name: /People/ }).click();
  await expect(alex.getByRole("dialog")).toBeVisible();
  await assertShellUsable(alex);
  await alex
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const guestUrl = await alex.getByLabel("One-time invitation").inputValue();
  const guestInvite = new URLSearchParams(new URL(guestUrl).hash.slice(1)).get(
    "invite",
  );
  if (!guestInvite) throw new Error("Invitation has no token");
  await alex.getByLabel("Close panel").click();
  await register(blair, guestInvite, "Blair");
  await expect(
    blair.getByRole("heading", { name: roomName, exact: true }),
  ).toBeVisible();
  const members = (await snapshot()).members;
  expect(members.map((member) => member.name).sort()).toEqual([
    "Alex",
    "Blair",
  ]);
  expect(new Set(members.map((member) => member.id)).size).toBe(2);
  recordClaim(
    "Two separately authenticated human browser sessions joined through one-time invitation",
  );

  await Promise.all([
    send(alex, "Alex joins the conversation."),
    send(blair, "Blair joins independently."),
  ]);
  for (const page of [alex, blair]) {
    await expect(page.locator('article[data-author="Alex"]')).toContainText(
      "Alex joins",
    );
    await expect(page.locator('article[data-author="Blair"]')).toContainText(
      "Blair joins",
    );
  }
  let droppedResponse = false;
  await alex.route(`**/api/rooms/${roomId}/messages`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (!droppedResponse) {
      droppedResponse = true;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await alex
    .getByLabel("Message the room")
    .fill("One accepted message despite retry");
  await alex.getByLabel("Send message", { exact: true }).click();
  await expect(alex.getByRole("alert")).toBeVisible();
  await expect(alex.getByLabel("Message the room")).toHaveValue(
    "One accepted message despite retry",
  );
  await alex.getByLabel("Send message", { exact: true }).click();
  await expect(alex.getByLabel("Message the room")).toHaveValue("");
  await expect(
    blair.getByText("One accepted message despite retry", { exact: true }),
  ).toHaveCount(1);
  expect(
    (await snapshot()).messages.filter(
      (message) => message.text === "One accepted message despite retry",
    ),
  ).toHaveLength(1);
  await alex.unroute(`**/api/rooms/${roomId}/messages`);
  recordClaim(
    "Concurrent human messages preserve authorship and an identical retried post appears once",
  );

  for (const [name, handle, instructions] of [
    [
      "Atlas",
      "atlas",
      "Bring a thoughtful, practical perspective. Participate in the room as yourself.",
    ],
    [
      "Nova",
      "nova",
      "Bring an imaginative, questioning perspective. Participate in the room as yourself.",
    ],
  ]) {
    await alex
      .getByRole("button", { name: "＋ Add agent", exact: true })
      .click();
    await alex.getByLabel("Name", { exact: true }).fill(name);
    await alex.getByLabel("Handle", { exact: true }).fill(handle);
    await alex
      .getByRole("dialog")
      .locator("select[name=provider]")
      .selectOption(provider);
    await alex.locator("input[name=model]").fill(model);
    await alex.getByLabel("Instructions", { exact: true }).fill(instructions);
    await alex.getByRole("button", { name: "Add agent", exact: true }).click();
    await expect(
      alex.locator(".participant").filter({ hasText: name }),
    ).toBeVisible();
  }
  await alex
    .getByRole("button", { name: "Pause new turns", exact: true })
    .click();
  await expect(
    blair.getByText("New agent turns paused", { exact: true }),
  ).toBeVisible();
  await selectMention(alex, "atlas", "Atlas");
  await alex.getByLabel("Message the room").press("End");
  await alex.getByLabel("Message the room").pressSequentially("@nova");
  await alex.getByRole("option", { name: /Nova/ }).click();
  await expect(alex.getByLabel("Message intent")).toHaveValue("request");
  await send(
    alex,
    "Introduce yourself in one sentence and offer your own view on what makes a shared conversation useful.",
  );
  for (const page of [alex, blair]) {
    await expect(page.locator(".pending-reply")).toHaveCount(2);
    await expect(page.locator(".pending-reply").first()).toContainText(
      "Queued",
    );
  }
  const queued = await snapshot();
  expect(queued.deliveries).toHaveLength(2);
  const agentIds = queued.agents.map((agent) => agent.id).sort();
  expect(queued.messages.at(-1)?.recipients.toSorted()).toEqual(agentIds);
  expect(queued.messages.at(-1)?.text).not.toContain("@");
  await send(
    blair,
    "A second human can still contribute while both requests wait.",
  );
  expect((await snapshot()).deliveries).toHaveLength(2);
  recordClaim(
    "Structured recipients route a request without textual mentions; both browsers show pending work and remain writable while paused",
  );

  await alex
    .getByRole("button", { name: "Resume agents", exact: true })
    .first()
    .click();
  await settle();
  const introductions = await snapshot();
  for (const id of agentIds)
    expect(
      introductions.messages.some(
        (message) =>
          message.kind === "agent" &&
          message.authorId === id &&
          message.status === "complete",
      ),
    ).toBe(true);
  for (const page of [alex, blair]) {
    await expect(page.locator(".pending-reply")).toHaveCount(0);
    await expect(
      page.locator('article[data-author="Atlas"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('article[data-author="Nova"]').first(),
    ).toBeVisible();
  }
  expect(
    introductions.messages.every((message) =>
      ["human", "agent", "system"].includes(message.kind),
    ),
  ).toBe(true);
  recordClaim(
    "Two real agents independently published replies to a natural request and settled pending status",
  );

  const beforePrivate = introductions.messages.length;
  await send(
    alex,
    "Quoted names @atlas and @nova are ordinary text in this message, not a request to respond.",
  );
  await expect
    .poll(async () => (await snapshot()).messages.length)
    .toBe(beforePrivate + 1);
  expect((await snapshot()).deliveries).toHaveLength(
    introductions.deliveries.length,
  );
  recordClaim(
    "Raw narrative mentions do not wake agents without structured addressing",
  );

  await selectMention(blair, "nova", "Nova");
  await blair.getByLabel("Message intent").selectOption("notice");
  const beforeNotice = await snapshot();
  await send(
    blair,
    "Thanks, that is all the context for now. There is no new question or task and no public reply is needed.",
  );
  await settle(beforeNotice.deliveries);
  const afterNotice = await snapshot();
  expect(
    afterNotice.messages.filter((message) => message.kind === "agent"),
  ).toHaveLength(
    beforeNotice.messages.filter((message) => message.kind === "agent").length,
  );
  await expect(blair.locator(".pending-reply")).toHaveCount(0);
  recordClaim(
    "An optional natural context notice completed without a public acknowledgment or endless pending indicator",
  );

  await selectMention(alex, "atlas", "Atlas");
  const beforePeer = await snapshot();
  await send(
    alex,
    "Ask Nova for one different perspective on whether friendship makes life meaningful. Let Nova answer independently in this room, then briefly respond to Nova's actual point. Do not write Nova's answer yourself.",
  );
  await settle(beforePeer.deliveries);
  await expect
    .poll(
      async () => {
        const current = await snapshot();
        const previousIds = new Set(
          beforePeer.messages.map((message) => message.id),
        );
        const additions = current.messages.filter(
          (message) => !previousIds.has(message.id),
        );
        return (
          additions.some(
            (message) =>
              message.authorName === "Atlas" &&
              message.recipients.some(
                (id) =>
                  current.agents.find((agent) => agent.id === id)?.name ===
                  "Nova",
              ),
          ) &&
          additions.some(
            (message) =>
              message.authorName === "Nova" && message.kind === "agent",
          )
        );
      },
      { timeout: 300000 },
    )
    .toBe(true);
  await settle(beforePeer.deliveries);
  recordClaim(
    "A natural peer request produced an authenticated Atlas request and independent Nova publication",
  );

  await selectMention(alex, "atlas", "Atlas");
  const beforeStop = await snapshot();
  await send(
    alex,
    "Before answering, use a shell tool to wait twenty seconds. Then share one idea for a community garden.",
  );
  const atlasWork = alex
    .locator(".working > span")
    .filter({ hasText: "Atlas" });
  await expect(
    atlasWork.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await selectMention(blair, "atlas", "Atlas");
  await send(
    blair,
    "While you work, please also consider accessibility for older neighbors.",
  );
  const previousIds = new Set(
    beforeStop.deliveries.map((delivery) => delivery.id),
  );
  await expect
    .poll(async () =>
      (await snapshot()).deliveries
        .filter((delivery) => !previousIds.has(delivery.id))
        .map((delivery) => delivery.state)
        .sort(),
    )
    .toEqual(["queued", "running"]);
  await expect(
    alex.locator('article[data-author="Blair"]').last(),
  ).toContainText("While you work");
  recordClaim(
    "A second human can send an addressed follow-up while an agent is running; it remains durably queued",
  );
  await atlasWork.getByRole("button", { name: "Stop", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot()).deliveries
        .filter((delivery) => !previousIds.has(delivery.id))
        .map((delivery) => delivery.state),
    )
    .toEqual(["stopped", "stopped"]);
  await expect(alex.locator(".pending-reply")).toHaveCount(0);
  recordClaim(
    "Stop cancels the selected agent activation and removes its pending reply",
  );

  await alex
    .getByRole("button", { name: "Room controls", exact: true })
    .click();
  await alex.getByLabel("Agent turn budget").fill("1");
  await alex
    .getByRole("button", { name: "Save controls", exact: true })
    .click();
  expect((await snapshot()).room.maxActivations).toBe(1);
  await alex
    .getByRole("button", { name: "Room controls", exact: true })
    .click();
  await alex.getByLabel("Agent turn budget").fill("");
  await alex
    .getByRole("button", { name: "Save controls", exact: true })
    .click();
  expect((await snapshot()).room.maxActivations).toBeNull();
  recordClaim(
    "Owner can set a visible turn budget or explicitly select unlimited turns",
  );

  await alex
    .getByRole("button", { name: "Room controls", exact: true })
    .click();
  await alex
    .getByRole("button", { name: "View agent activity", exact: true })
    .click();
  await expect(
    alex.getByRole("heading", { name: "Agent activity", exact: true }),
  ).toBeVisible();
  await expect(alex.locator(".activity-details")).toContainText(provider);
  await expect(alex.locator(".activity-details")).toContainText(
    "Private session",
  );
  await alex.getByLabel("Close panel").click();
  await expect(
    blair.getByRole("button", { name: "Room controls", exact: true }),
  ).toHaveCount(0);
  const firstAgent = (await snapshot()).agents[0];
  expect(
    (
      await second.request.get(
        `${origin}/api/rooms/${roomId}/agents/${firstAgent.id}/activity`,
      )
    ).status(),
  ).toBe(403);
  recordClaim(
    "Owner can inspect execution metadata while another human cannot access the private activity endpoint",
  );

  await blair.reload();
  await expect(
    blair.locator('article[data-author="Nova"]').first(),
  ).toBeVisible();
  await alex.screenshot({
    path: `${evidenceDirectory}/participation-desktop.png`,
    fullPage: true,
  });
  await blair.setViewportSize({ width: 390, height: 844 });
  await blair.getByRole("button", { name: /People/ }).click();
  await expect(blair.getByRole("dialog")).toBeVisible();
  await assertShellUsable(blair);
  await blair.getByLabel("Close panel").click();
  await expect(blair.getByRole("dialog")).toBeHidden();
  await assertShellUsable(blair);
  await send(
    blair,
    "Mobile participant still has a working composer after closing People.",
  );
  await blair.screenshot({
    path: `${evidenceDirectory}/participation-mobile.png`,
    fullPage: true,
  });
  recordClaim(
    "Reload recovers public history; compact shared drawer leaves app root usable and composer functional",
  );
  expect(failures).toEqual([]);
  await writeFile(
    `${evidenceDirectory}/participation-browser.json`,
    JSON.stringify(
      {
        origin,
        roomId,
        claims,
        failures,
        provider,
        model,
        completed: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ roomId, claims, failures }));
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true });
  try {
    await alex.screenshot({
      path: `${evidenceDirectory}/participation-failed.png`,
      fullPage: true,
    });
  } catch (captureError) {
    console.error("Could not capture failed browser state", captureError);
  }
  await writeFile(
    `${evidenceDirectory}/participation-failed.json`,
    JSON.stringify({ roomId, claims, failures, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
