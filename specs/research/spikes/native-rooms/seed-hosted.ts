import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createNodeBbSdk } from "../../../../packages/sdk/src/node.ts";

const root = process.env.ROOMS_HOSTED_QA_ROOT;
assert(root?.startsWith("/Users/admin/rooms-native-qa/"));
const url = "https://diary-butler-leone-heavy.trycloudflare.com";
const credentials = JSON.parse(await readFile("/Users/admin/rooms-native-qa/preview-owner-private.json", "utf8"));
await mkdir(root, { recursive: false, mode: 0o700 });
let token = "";
async function request(path: string, body?: object) {
  const response = await fetch(url + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Rooms-Request": "1", Origin: url, ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
const native = await request("/api/v1/rooms/session");
assert.equal(native.enabled, true);
const owner = await request("/api/auth/token", credentials);
token = owner.token;
const sdk = createNodeBbSdk({ baseUrl: url, fetch: (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Authorization: "Bearer " + token } }) });
const hosts = await sdk.hosts.list();
const host = hosts.find((host) => host.status === "connected");
assert(host);
const workspace = join(root, "project");
await mkdir(workspace, { mode: 0o700 });
await writeFile(join(workspace, "README.md"), "# Hosted Rooms verification\n\nDisposable workspace for two humans and two BB agents.\n");
await writeFile(join(workspace, "AGENTS.md"), "# Hosted acceptance\n\nWork only in this disposable fixture.\n");
execFileSync("git", ["init", "-b", "main", workspace], { stdio: "ignore" });
execFileSync("git", ["-C", workspace, "add", "."]);
execFileSync("git", ["-C", workspace, "-c", "user.name=Rooms QA", "-c", "user.email=rooms-qa@example.invalid", "commit", "-m", "Initialize hosted acceptance"], { stdio: "ignore" });
const project = await sdk.projects.create({ name: "Hosted acceptance", source: { type: "local_path", hostId: host.id, path: workspace } });
const room = await request("/api/rooms", { name: "Hosted invitation fixture", projectId: project.id, defaultEnvironmentId: null, sectionId: null });
const invite = await request(`/api/rooms/${room.id}/invites`, {});
const partner = { handle: "hosted" + randomBytes(6).toString("hex"), name: "Hosted partner", password: randomBytes(24).toString("base64url") };
const registered = await request("/api/auth/register", { ...partner, invite: invite.invite });
await writeFile(join(root, "fixture-private.json"), JSON.stringify({ url, operator: { ...credentials, id: owner.user.id }, operator2: { ...partner, id: registered.user.id }, projectId: project.id, roomId: room.id, hostId: host.id, workspace, data: "/Users/admin/rooms-v2-data", ownerToken: token }, null, 2), { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ created: true, projectId: project.id, seedRoomId: room.id, fixture: join(root, "fixture-private.json") }));
