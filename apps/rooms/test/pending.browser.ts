import { chromium, expect } from "@playwright/test";
import type { Snapshot } from "../src/contracts.js";
const origin = process.env.ROOMS_TEST_ORIGIN ?? "http://127.0.0.1:38900";
const user = { id: "human", handle: "alex", name: "Alex QA" };
const snapshot: Snapshot = {
  room: {
    id: "pending-qa",
    name: "Pending replies QA",
    ownerId: user.id,
    defaultAgentId: null,
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
    lastSeq: 0,
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
      depth: 0,
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
    baseline: 0,
  })),
  online: [user.id],
};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/events")) return route.abort();
  const body = path === "/api/me" ? { user, rooms: [snapshot.room] } : snapshot;
  await route.fulfill({ json: body });
});
try {
  await page.goto(origin);
  const pending = page.locator(".conversation .pending-reply");
  await expect(pending).toHaveCount(2);
  await expect(pending.first()).toContainText(
    "Waiting for Builder’s first response",
  );
  await expect(pending.last()).toContainText(
    "Waiting for Reviewer’s first response",
  );
  const elapsed = pending.first().locator(".pending-elapsed");
  const initial = await elapsed.textContent();
  await expect(elapsed).not.toHaveText(initial!);
  await page.getByLabel("Message the room").fill("I can keep typing");
  await page.screenshot({
    path: "/Users/admin/rooms-data/evidence/pending-desktop.png",
    fullPage: true,
  });
  console.log(
    "PASS two visible waiting replies before first token, live elapsed time, usable composer",
  );
  snapshot.deliveries[0].state = "queued";
  snapshot.agents[0].status = "idle";
  snapshot.deliveries[1].state = "dispatching";
  snapshot.room.revision++;
  await expect(pending.first()).toContainText("Queued for Builder");
  await expect(pending.last()).toContainText("Starting Reviewer");
  console.log("PASS queued and starting states");
  snapshot.deliveries[0].state = "running";
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
    depth: 1,
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
  snapshot.messages[1].status = "complete";
  snapshot.room.revision++;
  await expect(pending).toHaveCount(2);
  await expect(pending.first()).toContainText("Builder is working");
  snapshot.deliveries[0].state = "stopped";
  snapshot.deliveries[1].state = "error";
  snapshot.room.revision++;
  await expect(pending).toHaveCount(0);
  console.log(
    "PASS waiting continues between outputs and clears on stop/error",
  );
  snapshot.deliveries[0].state = "running";
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
    path: "/Users/admin/rooms-data/evidence/pending-mobile.png",
    fullPage: true,
  });
  snapshot.deliveries[0].state = "complete";
  snapshot.room.revision++;
  await expect(pending).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "PASS pending survives reload, fits mobile, clears on completion; no browser errors",
  );
} finally {
  await browser.close();
}
