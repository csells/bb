import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { snapshotSchema } from "../src/contracts.js";
const origin =
  process.env.ROOMS_TEST_ORIGIN ??
  "https://istanbul-likes-script-study.trycloudflare.com";
const data = process.env.ROOMS_DATA_DIR ?? "/Users/admin/rooms-data";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: data + "/evidence/agent-owner-state.json",
});
const page = await context.newPage();
async function post(path: string, body: unknown, method = "POST") {
  const response = await context.request.fetch(origin + "/api" + path, {
    method,
    headers: { "X-Rooms-Request": "1" },
    data: body,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
try {
  const reuse = process.env.ROOMS_DISCUSSION_ROOM;
  const room = reuse
    ? (await (await context.request.get(origin + `/api/rooms/${reuse}`)).json())
        .room
    : await post("/rooms", { name: "Open discussion QA " + Date.now() });
  const agents = [];
  if (!reuse)
    for (const [name, instructions] of [
      [
        "Builder",
        "Give concrete implementation suggestions. Respond only as yourself.",
      ],
      [
        "Reviewer",
        "Review independently, identify defects and propose improvements. Respond only as yourself.",
      ],
    ]) {
      agents.push(
        await post(`/rooms/${room.id}/agents`, {
          name,
          handle: name.toLowerCase(),
          provider: "pi",
          model: "rooms-local/qwen3:4b-instruct-2507-q4_K_M",
          instructions,
        }),
      );
    }
  if (!reuse)
    await post(`/rooms/${room.id}/default`, { agentId: agents[0].id }, "PUT");
  await page.addInitScript(
    (id) => localStorage.setItem("bb-room", id),
    room.id,
  );
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: room.name, exact: true }),
  ).toBeVisible();
  const before = snapshotSchema.parse(
    await (await context.request.get(origin + `/api/rooms/${room.id}`)).json(),
  );
  await page
    .getByLabel("Message the room")
    .fill(
      "can you two debate the meaning of life for me. I'd like to see you interact with each other, so I gave you an easy question to answer. : )",
    );
  await page.getByLabel("Send message").click();
  await expect
    .poll(
      async () => {
        const response = await context.request.get(
          origin + `/api/rooms/${room.id}`,
        );
        expect(response.ok()).toBe(true);
        const result = snapshotSchema.parse(await response.json());
        expect(result.deliveries.filter((d) => d.state === "error")).toEqual(
          [],
        );
        return (
          result.deliveries.length > before.deliveries.length &&
          result.deliveries.every((d) => d.state === "complete")
        );
      },
      { timeout: 180000, intervals: [1000] },
    )
    .toBe(true);
  const result = snapshotSchema.parse(
    await (await context.request.get(origin + `/api/rooms/${room.id}`)).json(),
  );
  const promptId = result.messages.filter((m) => m.kind === "human").at(-1)!.id;
  const children = new Set([promptId]);
  const replies = result.messages.filter((m) => {
    if (m.kind !== "agent" || !m.causeId || !children.has(m.causeId))
      return false;
    children.add(m.id);
    return true;
  });
  await writeFile(
    data + "/evidence/discussion-result.json",
    JSON.stringify({ roomId: room.id, replies }, null, 2),
  );
  for (const name of ["Builder", "Reviewer"]) {
    const authored = replies.filter((m) => m.authorName === name);
    expect(
      authored.length,
      `${name} should participate in the debate`,
    ).toBeGreaterThan(0);
    for (const m of authored) {
      expect(m.text).toMatch(/meaning|purpose|life/i);
      expect(m.text).not.toMatch(
        /(?:cannot|can.t|unable to) (?:debate|engage in (?:a |the )?(?:philosophical )?debate)|outside (?:the |my )?scope|only (?:discuss|assist with|address) (?:technical|coding)|restricted to (?:technical|coding)/i,
      );
    }
    await expect(
      page.locator(`article[data-author="${name}"]`).first(),
    ).toBeVisible();
  }
  expect(
    result.deliveries.some(
      (d) =>
        result!.messages.find((m) => m.id === d.messageId)?.kind === "agent",
    ),
  ).toBe(true);
  console.log(
    "PASS real meaning-of-life discussion and agent-to-agent handoff",
    room.id,
    replies.map((m) => ({ name: m.authorName, text: m.text })),
  );
} finally {
  await browser.close();
}
