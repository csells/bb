import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { snapshotSchema } from "../src/contracts.js";
const origin = process.env.ROOMS_TEST_ORIGIN ?? "http://127.0.0.1:38900";
const data = process.env.ROOMS_DATA_DIR ?? "/Users/admin/rooms-data";
const { roomId } = JSON.parse(
  await readFile(data + "/evidence/agent-fixture.json", "utf8"),
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: data + "/evidence/agent-owner-state.json",
});
const page = await context.newPage();
async function snapshot() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await context.request.get(origin + "/api/rooms/" + roomId);
    if (response.status() < 500)
      return snapshotSchema.parse(await response.json());
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Gateway did not recover within 30 seconds");
}
async function post(path: string, body: unknown) {
  const response = await context.request.post(
    origin + "/api/rooms/" + roomId + path,
    { headers: { "X-Rooms-Request": "1" }, data: body },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function finish() {
  await expect
    .poll(
      async () => {
        const s = await snapshot();
        const errors = s.deliveries.filter((d) => d.state === "error");
        expect(errors).toEqual([]);
        return s.deliveries.every((d) =>
          ["complete", "stopped"].includes(d.state),
        );
      },
      { timeout: 180000, intervals: [700] },
    )
    .toBe(true);
}
try {
  await page.goto(origin);
  await expect(page.locator(".participant")).toHaveCount(2);
  const before = await snapshot();
  const builder = before.agents.find((a) => a.handle === "builder")!,
    reviewer = before.agents.find((a) => a.handle === "reviewer")!;
  const send = (text: string) =>
    post("/messages", {
      text,
      requestId: crypto.randomUUID(),
      recipients: [builder.id],
    });
  await send(
    "Reply with exactly this one line and nothing else: [[ask @reviewer: Reply with HANDOFF-OK and one sentence about reviewing.]]",
  );
  await finish();
  const handoff = await snapshot();
  expect(handoff.deliveries.length).toBe(before.deliveries.length + 2);
  expect(
    handoff.messages.some(
      (m) => m.authorId === reviewer.id && m.text.includes("HANDOFF-OK"),
    ),
  ).toBe(true);
  console.log(
    "PASS explicit agent-to-agent handoff ran the other persistent agent",
  );
  await send(
    "Use bash to run sleep 25, then reply AFTER-WAIT. Do not address another agent.",
  );
  await expect
    .poll(
      async () => {
        const s = await snapshot();
        return s.messages.some(
          (m) =>
            m.authorId === builder.id &&
            m.kind === "tool" &&
            m.status === "streaming" &&
            m.text.includes("sleep"),
        );
      },
      { timeout: 90000, intervals: [700] },
    )
    .toBe(true);
  await page
    .locator(".working span")
    .filter({ hasText: "Builder" })
    .getByRole("button", { name: "Steer" })
    .click();
  await page
    .getByLabel("Message the room")
    .fill(
      "Change your final response to STEERING-ACCEPTED. Do not say AFTER-WAIT.",
    );
  await page.getByLabel("Send message").click();
  await finish();
  expect(
    (await snapshot()).messages
      .filter((m) => m.authorId === builder.id && m.kind === "agent")
      .at(-1)?.text,
  ).toContain("STEERING-ACCEPTED");
  console.log("PASS UI steering changed the real agent final response");
  await send("Use bash to run sleep 45. After that reply FINISHED-LONG-WAIT.");
  await expect
    .poll(
      async () => {
        const s = await snapshot();
        return s.messages.some(
          (m) =>
            m.authorId === builder.id &&
            m.kind === "tool" &&
            m.status === "streaming" &&
            m.text.includes("sleep 45"),
        );
      },
      { timeout: 90000, intervals: [700] },
    )
    .toBe(true);
  await page
    .locator(".working span")
    .filter({ hasText: "Builder" })
    .getByRole("button", { name: "Stop" })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot()).agents.find((a) => a.id === builder.id)?.status,
      { timeout: 15000 },
    )
    .toBe("idle");
  expect((await snapshot()).deliveries[0].state).toBe("stopped");
  console.log("PASS UI Stop cancelled a real running tool and delivery");
  await send(
    "Use bash to run sleep 15 and then cat rooms-proof.txt. Report RECOVERED followed by the exact file contents.",
  );
  await expect
    .poll(
      async () => {
        const s = await snapshot();
        return s.messages.some(
          (m) =>
            m.authorId === builder.id &&
            m.kind === "tool" &&
            m.status === "streaming" &&
            m.text.includes("sleep 15"),
        );
      },
      { timeout: 90000, intervals: [700] },
    )
    .toBe(true);
  execFileSync("launchctl", [
    "kickstart",
    "-k",
    `gui/${process.getuid!()}/bb.rooms.gateway`,
  ]);
  await new Promise((r) => setTimeout(r, 3000));
  await finish();
  await expect(page.locator(".conversation")).toContainText("RECOVERED", {
    timeout: 15000,
  });
  const recovered = await snapshot();
  expect(
    recovered.messages
      .filter((m) => m.authorId === builder.id && m.kind === "agent")
      .at(-1)?.text,
  ).toContain("ROOM-PROOF-42");
  expect(recovered.agents.find((a) => a.id === builder.id)?.threadId).toBe(
    builder.threadId,
  );
  console.log(
    "PASS gateway restart reattached to the same real BB thread and retained workspace",
  );
  await page.screenshot({
    path: data + "/evidence/controls-desktop.png",
    fullPage: true,
  });
  await writeFile(
    data + "/evidence/controls-result.json",
    JSON.stringify({
      roomId,
      passed: ["handoff", "steering", "stop", "restart"],
      at: new Date().toISOString(),
    }),
  );
} finally {
  await browser.close();
}
