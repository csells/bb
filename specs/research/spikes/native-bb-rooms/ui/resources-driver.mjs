import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import readline from "node:readline";
const require = createRequire(new URL("../../../../../apps/rooms/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const fixture = JSON.parse(await readFile(process.env.ROOMS_NATIVE_QA_FIXTURE, "utf8"));
const output = process.env.ROOMS_NATIVE_QA_OUTPUT;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const observations = [];
page.on("pageerror", (error) => errors.push(error.message));
function sanitize(value) {
  let text = String(value);
  for (const person of [fixture.operator, fixture.operator2, fixture.guest]) if (person?.password) text = text.replaceAll(person.password, "[redacted]");
  return text;
}
try {
  await page.goto(new URL("/rooms", fixture.url).href);
  await page.getByLabel("Handle", { exact: true }).fill(fixture.operator.handle);
  await page.getByLabel("Password", { exact: true }).fill(fixture.operator.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible({ timeout: 30000 });
  console.log(JSON.stringify({ ready: true, snapshot: await page.locator("body").ariaSnapshot() }));
  const lines = readline.createInterface({ input: process.stdin });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for await (const line of lines) {
    if (line === "close") break;
    try {
      const result = await new AsyncFunction("page", "expect", "output", "writeFile", "fixture", line)(page, expect, output, writeFile, fixture);
      observations.push({ command: line, ok: true, result: result ?? null });
      console.log(JSON.stringify({ ok: true, result: result ?? null }));
    } catch (error) {
      observations.push({ command: line, ok: false, error: sanitize(error.stack ?? error) });
      console.log(JSON.stringify({ ok: false, error: sanitize(error.stack ?? error) }));
    }
  }
} finally {
  await writeFile(`${output}/page-errors.json`, JSON.stringify(errors));
  await writeFile(`${output}/observations.json`, sanitize(JSON.stringify(observations, null, 2)));
  await browser.close();
  process.stdin.pause();
  console.log(JSON.stringify({ browserClosed: true }));
}
