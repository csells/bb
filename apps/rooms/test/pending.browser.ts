import { chromium, webkit, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Snapshot } from "../src/contracts.js";
import type { PendingInteractionPayload } from "@bb/domain";
const origin = process.env.ROOMS_TEST_ORIGIN ?? "http://127.0.0.1:38900";
const evidence =
  process.env.ROOMS_TEST_EVIDENCE ?? "/tmp/rooms-pending-evidence";
await mkdir(evidence, { recursive: true });
const user = { id: "human", handle: "alex", name: "Alex QA" };
const snapshot: Snapshot = {
  room: {
    id: "pending-qa",
    name: "Pending replies QA",
    ownerId: user.id,
    paused: false,
    pauseReason: null,
    maxActivations: null,
    activationsUsed: 2,
    revision: 1,
  },
  members: [{ ...user, role: "owner" }],
  agents: ["Builder", "Reviewer"].map((name) => ({
    id: name,
    roomId: "pending-qa",
    handle: name.toLowerCase(),
    name,
    provider: "pi",
    model: "",
    instructions: "",
    projectId: null,
    threadId: null,
    status: "working",
  })),
  messages: [
    {
      id: "prompt",
      roomId: "pending-qa",
      authorId: user.id,
      authorName: user.name,
      kind: "human",
      text: "@builder @reviewer Introduce yourselves.",
      status: "complete",
      createdAt: Date.now(),
      causeId: null,
      intent: "request",
      recipients: ["Builder", "Reviewer"],
      replyTo: null,
    },
  ],
  deliveries: ["Builder", "Reviewer"].map((agentId) => ({
    id: agentId,
    roomId: "pending-qa",
    agentId,
    messageId: "prompt",
    state: "running",
    error: null,
    startedAt: Date.now(),
    createdAt: Date.now(),
    intent: "request",
    activationId: "activation-" + agentId,
    threadId: null,
    outcome: null,
  })),
  online: [user.id],
};
const browserType =
  process.env.ROOMS_TEST_BROWSER === "webkit" ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const page = await browser.newPage({ hasTouch: true, isMobile: true });
const errors: string[] = [];
let interactions: { id: string; payload: PendingInteractionPayload }[] = [];
const interactionSubmissions: unknown[] = [];
const steeringSubmissions: unknown[] = [];
const policySubmissions: unknown[] = [];
let steeringDelivery: "sent" | "queued" = "sent";
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/events")) return route.abort();
  if (path.endsWith("/policy") && route.request().method() === "PUT") {
    policySubmissions.push(route.request().postDataJSON());
    return route.fulfill({ json: snapshot.room });
  }
  if (path.endsWith("/steer")) {
    steeringSubmissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { delivery: steeringDelivery } });
  }
  if (path.endsWith("/interactions"))
    return route.fulfill({
      json: path.includes("/Builder/") ? interactions : [],
    });
  if (path.includes("/interactions/")) {
    interactionSubmissions.push(route.request().postDataJSON());
    interactions = [];
    return route.fulfill({ json: { ok: true } });
  }
  const body = path === "/api/me" ? { user, rooms: [snapshot.room] } : snapshot;
  await route.fulfill({ json: body });
});
try {
  await page.goto(origin);
  const pending = page.locator(".conversation .pending-reply");
  await expect(pending).toHaveCount(2);
  await expect(pending.first()).toContainText(
    "Builder is working on your request",
  );
  await expect(pending.last()).toContainText(
    "Reviewer is working on your request",
  );
  const elapsed = pending.first().locator(".pending-elapsed");
  const initial = await elapsed.textContent();
  await expect(elapsed).not.toHaveText(initial!);
  await page.getByLabel("Message the room").fill("I can keep typing");
  await page.screenshot({
    path: evidence + "/pending-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS two visible waiting replies before first token, live elapsed time, usable composer",
  );
  await page
    .getByRole("button", { name: "Room controls", exact: true })
    .click();
  await page.getByLabel("Agent turn budget").fill("");
  snapshot.room.maxActivations = 1;
  snapshot.room.revision++;
  await expect(
    page
      .locator(".rooms-drawer form > p")
      .filter({ hasText: "agent turns used" }),
  ).toContainText("of 1");
  await expect(page.getByLabel("Agent turn budget")).toHaveValue("");
  await page
    .getByRole("button", { name: "Save controls", exact: true })
    .click();
  await expect.poll(() => policySubmissions.length).toBe(1);
  expect(policySubmissions[0]).toEqual({ paused: false, maxActivations: null });
  await expect(page.getByRole("dialog")).toBeHidden();
  snapshot.room.maxActivations = null;
  snapshot.room.revision++;
  console.log(
    "PASS an arriving room snapshot cannot overwrite an in-progress unlimited budget draft",
  );
  snapshot.deliveries[0].state = "uncertain";
  snapshot.deliveries[0].error =
    "A steering acknowledgment was lost. Follow-ups are retained until recovery.";
  snapshot.agents[0].status = "uncertain";
  snapshot.deliveries.push({
    ...snapshot.deliveries[0],
    id: "retained-follow-up",
    messageId: "follow-up",
    state: "queued",
    error: null,
    activationId: null,
    startedAt: null,
    createdAt: Date.now() + 1,
  });
  snapshot.room.revision++;
  await page.reload();
  await expect(
    page.locator(".participant").filter({ hasText: "Builder" }),
  ).toContainText("Needs attention");
  const attention = page.locator(".attention-reply");
  await expect(attention).toContainText("Builder needs attention");
  await expect(attention).toContainText("A steering acknowledgment was lost");
  await expect(attention).toContainText("Accepted follow-ups remain queued");
  await expect(attention.locator(".pulse, .pending-elapsed")).toHaveCount(0);
  await expect(pending.filter({ hasText: "Queued for Builder" })).toHaveCount(
    1,
  );
  await page
    .getByLabel("Message the room")
    .fill("Recovery does not block human conversation");
  snapshot.deliveries.pop();
  snapshot.deliveries[0].state = "running";
  snapshot.deliveries[0].error = null;
  snapshot.agents[0].status = "working";
  snapshot.room.revision++;
  await expect(attention).toHaveCount(0);
  await page.getByLabel("Message the room").fill("I can keep typing");
  console.log(
    "PASS uncertain execution stays visibly needs attention after reload despite newer queued follow-ups, without an active-work indicator",
  );
  const grant = { network: { enabled: true }, fileSystem: null };
  interactions = [
    {
      id: "permission-request",
      payload: {
        kind: "approval",
        subject: {
          kind: "permission_grant",
          itemId: "tool-call",
          toolName: "shell",
          permissions: grant,
        },
        reason: "The requested room action needs network access.",
        availableDecisions: ["allow_once", "deny"],
      },
    },
  ];
  snapshot.agents[0].threadId = "permission-fixture";
  snapshot.room.revision++;
  await expect(
    page.getByRole("button", { name: "Allow once", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect.poll(() => interactionSubmissions.length).toBe(1);
  expect(interactionSubmissions[0]).toEqual({
    decision: "allow_once",
    grantedPermissions: grant,
  });
  interactions = [
    {
      id: "deny-only-request",
      payload: {
        kind: "approval",
        subject: {
          kind: "permission_grant",
          itemId: "restricted-tool",
          toolName: "shell",
          permissions: grant,
        },
        reason: null,
        availableDecisions: ["deny"],
      },
    },
  ];
  await expect(
    page.getByRole("button", { name: "Allow once", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect.poll(() => interactionSubmissions.length).toBe(2);
  expect(interactionSubmissions[1]).toEqual({ decision: "deny" });
  await expect(page.locator(".approval")).toHaveCount(0);
  interactions = [
    {
      id: "session-request",
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          itemId: "session-command",
          command: "room post",
          cwd: null,
          actions: [],
          sessionGrant: grant,
        },
        reason: null,
        availableDecisions: ["allow_for_session"],
      },
    },
  ];
  await expect(
    page.getByRole("button", { name: "Allow for session", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Allow once", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Deny", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Allow for session", exact: true })
    .click();
  await expect.poll(() => interactionSubmissions.length).toBe(3);
  expect(interactionSubmissions[2]).toEqual({
    decision: "allow_for_session",
    grantedPermissions: grant,
  });
  await expect(page.locator(".approval")).toHaveCount(0);
  console.log(
    "PASS permission grants submit the requested profile and only provider-offered decisions are shown",
  );
  for (const provider of ["codex", "claude-code", "pi"] as const) {
    snapshot.agents[0].provider = provider;
    snapshot.room.revision++;
    steeringDelivery = provider === "claude-code" ? "queued" : "sent";
    await page.reload();
    const work = page.locator(".working > span").filter({ hasText: "Builder" });
    await work.getByRole("button", { name: "Steer now", exact: true }).click();
    await page
      .getByLabel("Message the room")
      .fill(`Adjust perspective for ${provider}`);
    await page.getByLabel("Send message", { exact: true }).click();
    await expect(page.getByLabel("Message the room")).toHaveValue("");
    expect(steeringSubmissions.at(-1)).toMatchObject({
      text: `Adjust perspective for ${provider}`,
    });
    await expect(page.locator(".input-status")).toContainText(
      steeringDelivery === "queued"
        ? "Input accepted and queued"
        : "The agent may finish its current tool before reading it",
    );
  }
  await page.getByLabel("Message the room").fill("I can keep typing");
  console.log(
    "PASS Codex, Claude and Pi expose steering while working and display the actual sent or queued receipt",
  );
  snapshot.deliveries[0].error =
    "Could not reach the provider. Retrying status check.";
  snapshot.room.revision++;
  await expect(pending).toHaveCount(2);
  await expect(pending.first()).toContainText(
    "Unable to confirm execution status",
  );
  await expect(pending.first()).toContainText("Your request remains pending");
  await expect(page.getByLabel("Message the room")).toHaveValue(
    "I can keep typing",
  );
  snapshot.deliveries[0].error = null;
  snapshot.room.revision++;
  await expect(pending.first()).not.toContainText("Unable to confirm");
  await expect(pending.first()).toContainText(
    "Builder is working on your request",
  );
  console.log(
    "PASS temporary status failure stays pending, remains writable and recovers",
  );
  snapshot.deliveries[0].state = "queued";
  snapshot.agents[0].status = "idle";
  snapshot.deliveries[1].state = "dispatching";
  snapshot.room.revision++;
  await expect(pending.first()).toContainText("Queued for Builder");
  await expect(pending.last()).toContainText("Starting Reviewer");
  console.log("PASS queued and starting states");
  snapshot.deliveries[0].state = "running";
  snapshot.agents[0].status = "working";
  snapshot.messages.push({
    id: "reply",
    roomId: snapshot.room.id,
    authorId: "Builder",
    authorName: "Builder",
    kind: "agent",
    text: "Hello, I am Builder",
    status: "streaming",
    createdAt: Date.now(),
    causeId: "prompt",
    intent: "post",
    recipients: [],
    replyTo: "prompt",
  });
  snapshot.room.revision++;
  await expect(pending).toHaveCount(1);
  await expect(page.locator('article[data-author="Builder"]')).toContainText(
    "Hello, I am Builder",
  );
  await expect(pending).toContainText("Reviewer");
  console.log(
    "PASS actual streaming text replaces only its agent’s waiting reply",
  );
  snapshot.deliveries[0].error = "Provider status is temporarily unavailable.";
  snapshot.room.revision++;
  await expect(pending).toHaveCount(2);
  await expect(pending.first()).toContainText(
    "Unable to confirm execution status",
  );
  await expect(page.locator('article[data-author="Builder"]')).toContainText(
    "Hello, I am Builder",
  );
  snapshot.deliveries[0].error = null;
  snapshot.room.revision++;
  await expect(pending).toHaveCount(1);
  console.log(
    "PASS public streaming does not conceal a temporary status failure",
  );
  snapshot.messages[1].status = "complete";
  snapshot.room.revision++;
  await expect(pending).toHaveCount(2);
  await expect(pending.first()).toContainText("Builder is working");
  snapshot.deliveries[0].state = "stopped";
  snapshot.deliveries[1].state = "error";
  snapshot.agents[0].status = "stopped";
  snapshot.agents[1].status = "error";
  snapshot.room.revision++;
  await expect(pending).toHaveCount(0);
  console.log(
    "PASS waiting continues between outputs and clears on stop/error",
  );
  snapshot.deliveries[0].state = "running";
  snapshot.agents[0].status = "working";
  snapshot.messages.splice(1);
  snapshot.room.revision++;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(pending).toHaveCount(1);
  await expect(pending).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: evidence + "/pending-mobile.png",
    fullPage: true,
  });
  expect(
    await page
      .getByLabel("Message the room")
      .evaluate((node) => getComputedStyle(node).fontSize),
  ).toBe("16px");
  await page.getByRole("button", { name: /People/ }).click();
  await expect(
    page.getByRole("heading", { name: "People in this room" }),
  ).toBeVisible();
  expect(
    await page
      .locator("#root")
      .evaluate(
        (node) =>
          node.hasAttribute("inert") ||
          node.getAttribute("aria-hidden") === "true",
      ),
  ).toBe(false);
  await page.getByLabel("Close panel").click();
  await expect
    .poll(() =>
      page
        .locator(".rooms-drawer")
        .evaluate(
          (node) => node.getBoundingClientRect().top >= innerHeight - 1,
        ),
    )
    .toBe(true);
  await page.getByRole("button", { name: /Add agent/ }).click();
  const agentName = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(agentName).toBeVisible();
  expect(
    await agentName.evaluate((node) => getComputedStyle(node).fontSize),
  ).toBe("16px");
  await agentName.fill("Touch field remains usable");
  await expect(page.getByLabel("Close panel")).toBeInViewport();
  await page.getByLabel("Close panel").click();
  await page
    .getByLabel("Message the room")
    .fill("Composer remains usable after the drawer");
  await expect(page.getByLabel("Message the room")).toHaveValue(
    "Composer remains usable after the drawer",
  );
  console.log(
    "PASS compiled mobile touch inputs are16px; shared drawers preserve root and composer usability",
  );
  snapshot.deliveries[0].state = "complete";
  snapshot.deliveries[0].outcome = "no_reply";
  snapshot.agents[0].status = "idle";
  snapshot.room.revision++;
  await expect(pending).toHaveCount(0);
  await expect(
    page.locator(".participant").filter({ hasText: "Builder" }),
  ).toContainText("No public reply");
  expect(errors).toEqual([]);
  console.log(
    "PASS pending survives reload, fits mobile, clears on completion; no browser errors",
  );
} finally {
  await browser.close();
}
