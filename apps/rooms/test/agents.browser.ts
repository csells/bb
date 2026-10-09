import { chromium, expect } from "@playwright/test";
import { RoomsStore } from "../src/store.js";
import { writeFile, mkdir } from "node:fs/promises";
const origin = process.env.ROOMS_TEST_ORIGIN ?? "http://127.0.0.1:38900";
const data = process.env.ROOMS_DATA_DIR ?? "/Users/admin/rooms-data";
const stamp = Date.now().toString(36);
const store = new RoomsStore(data + "/rooms.sqlite");
const room = store.createRoom("Agent acceptance " + stamp, "");
const invite = store.invite(room.id, "owner");
store.close();
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all([
  browser.newContext(),
  browser.newContext(),
]);
const pages = await Promise.all(contexts.map((c) => c.newPage()));
const [alex, blair] = pages;
const errors: string[] = [];
for (const p of pages) p.on("pageerror", (e) => errors.push(e.message));
const password = crypto.randomUUID();
async function register(page: typeof alex, token: string, name: string) {
  await page.goto(origin + "/#invite=" + token);
  await page.getByLabel("Your name").fill(name);
  await page
    .getByLabel("Handle", { exact: true })
    .fill(name.toLowerCase() + "_" + stamp);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Join the room", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: room.name, exact: true }),
  ).toBeVisible();
}
async function snapshot() {
  const r = await contexts[0].request.get(origin + "/api/rooms/" + room.id);
  return r.json();
}
async function send(page: typeof alex, text: string) {
  await page.getByLabel("Message the room").fill(text);
  await page.getByLabel("Send message").click();
}
try {
  await register(alex, invite, "Alex");
  await alex.getByRole("button", { name: /People/ }).click();
  await alex
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const link = await alex.locator(".panel input[readonly]").inputValue();
  await alex.getByLabel("Close panel").click();
  await register(
    blair,
    new URLSearchParams(new URL(link).hash.slice(1)).get("invite")!,
    "Blair",
  );
  for (const [name, handle, role] of [
    ["Builder", "builder", "Give concrete implementation suggestions."],
    ["Reviewer", "reviewer", "Review independently and look for defects."],
  ]) {
    await alex
      .getByRole("button", { name: "＋ Add agent", exact: true })
      .click();
    await alex.getByLabel("Name", { exact: true }).fill(name);
    await alex.getByLabel("Handle", { exact: true }).fill(handle);
    await alex.locator("select[name=provider]").selectOption("pi");
    await alex
      .locator("input[name=model]")
      .fill("rooms-local/qwen3:4b-instruct-2507-q4_K_M");
    await alex.getByLabel("Role / instructions").fill(role);
    await alex.getByRole("button", { name: "Add agent", exact: true }).click();
    await expect(alex.locator(".participant")).toHaveCount(
      handle === "builder" ? 1 : 2,
    );
  }
  console.log(
    "Two human identities and two real Pi agents created through UI",
    room.id,
  );
  await mkdir(data + "/evidence", { recursive: true });
  await contexts[0].storageState({
    path: data + "/evidence/agent-owner-state.json",
  });
  await writeFile(
    data + "/evidence/agent-fixture.json",
    JSON.stringify({ roomId: room.id, stamp }),
    { mode: 0o600 },
  );
  const submittedAt = Date.now();
  await send(
    alex,
    "@builder @reviewer Introduce yourself using your assigned name. Then write ten numbered sentences about how humans and agents can collaborate in a shared conversation. Do not call tools or address the other agent.",
  );
  for (const page of pages) {
    await expect(page.locator(".conversation .pending-reply")).toHaveCount(2);
    await expect(
      page.locator(".conversation .pending-reply").first(),
    ).toContainText(/Waiting for|Starting|Queued/);
  }
  console.log(
    "PASS both humans see two pending replies before any agent text",
    { pendingMs: Date.now() - submittedAt },
  );
  const observed = new Map<string, Set<number>>();
  const firstTextMs = new Map<string, number>();
  let done = false;
  const until = Date.now() + 240000;
  while (Date.now() < until) {
    const s = await snapshot();
    for (const m of s.messages.filter((m: any) => m.kind === "agent")) {
      if (m.text && !firstTextMs.has(m.authorName))
        firstTextMs.set(m.authorName, Date.now() - submittedAt);
      const lengths = observed.get(m.authorName) ?? new Set();
      lengths.add(m.text.length);
      observed.set(m.authorName, lengths);
    }
    if (s.deliveries.some((d: any) => d.state === "error"))
      throw new Error(JSON.stringify(s.deliveries));
    if (
      s.deliveries.length >= 2 &&
      s.deliveries.every((d: any) => d.state === "complete")
    ) {
      done = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  expect(done).toBe(true);
  for (const page of pages)
    await expect(page.locator(".pending-reply")).toHaveCount(0);
  console.log(
    "First text observed via public API (milliseconds)",
    Object.fromEntries(firstTextMs),
  );
  for (const name of ["Builder", "Reviewer"]) {
    expect(observed.get(name)?.size).toBeGreaterThan(1);
    for (const p of pages)
      await expect(
        p.locator(`article[data-author="${name}"]`).last(),
      ).toContainText(new RegExp(name, "i"));
  }
  console.log(
    "PASS two actual agents streamed incremental output to both humans",
    Object.fromEntries([...observed].map(([k, v]) => [k, v.size])),
  );
  const initialCount = (await snapshot()).deliveries.length;
  await send(
    blair,
    "@builder Use your bash tool to create a file named rooms-proof.txt containing ROOM-PROOF-42, then read it with cat and report its exact contents.",
  );
  await expect
    .poll(
      async () => {
        const s = await snapshot();
        if (s.deliveries.some((d: any) => d.state === "error"))
          throw new Error(JSON.stringify(s.deliveries));
        return (
          s.deliveries.length > initialCount &&
          s.deliveries.every((d: any) => d.state === "complete")
        );
      },
      { timeout: 180000, intervals: [1000] },
    )
    .toBe(true);
  const result = await snapshot();
  expect(result.messages.some((m: any) => m.kind === "tool")).toBe(true);
  expect(
    result.messages.filter((m: any) => m.kind === "agent").at(-1).text,
  ).toContain("ROOM-PROOF-42");
  await blair.reload();
  await expect(blair.locator(".conversation")).toContainText("ROOM-PROOF-42");
  console.log(
    "PASS second human prompted real file tools, result and transcript survived reload",
  );
  await alex.screenshot({
    path: data + "/evidence/agents-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log("PASS real agents browser acceptance", room.id);
} finally {
  await browser.close();
}
