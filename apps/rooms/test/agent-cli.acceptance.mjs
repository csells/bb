import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, copyFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const data = await mkdtemp(join(tmpdir(), "rooms-cli-compiled-"));
const token = crypto.randomUUID();
const text =
  "Chris's selected public text\nSecond line — separate from private output";
let received;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  received = {
    authorization: request.headers.authorization === "Bearer " + token,
    path: request.url,
    command: JSON.parse(Buffer.concat(chunks).toString()),
  };
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ messageId: "compiled-cli-receipt" }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const evidence = {
  checks: [],
  aliasDirectory: data,
  canonicalDirectory: await realpath(data),
};
const check = (condition, label) => {
  if (!condition) throw new Error(label);
  evidence.checks.push(label);
  console.log("PASS " + label);
};
async function invoke(args) {
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}
try {
  const cli = join(data, "room.mjs"),
    credential = join(data, "activation.json");
  await copyFile(resolve(import.meta.dirname, "../dist/agent-cli.js"), cli);
  await writeFile(
    credential,
    JSON.stringify({
      endpoint: `http://127.0.0.1:${server.address().port}`,
      token,
      activationId: crypto.randomUUID(),
    }),
    { mode: 0o600 },
  );
  const help = await invoke([cli, "--help"]);
  check(
    help.code === 0 && help.stdout.includes("post"),
    "copied compiled CLI executes from temporary path, including macOS /var alias",
  );
  const result = await invoke([
    cli,
    "--activation",
    credential,
    "post",
    "--text",
    text,
  ]);
  check(
    result.code === 0 &&
      JSON.parse(result.stdout).messageId === "compiled-cli-receipt",
    "copied compiled CLI emits actual HTTP publication receipt",
  );
  check(
    received?.authorization &&
      received.path === "/api/agent/commands" &&
      received.command.operation === "post" &&
      received.command.args.text === text,
    "compiled subprocess transmits selected text under credential-bound authorization",
  );
  const invalid = await invoke([cli, "--activation", credential, "post"]);
  check(
    invalid.code !== 0 && invalid.stderr.length > 0,
    "invalid compiled CLI invocation fails visibly instead of exiting successfully without action",
  );
} catch (error) {
  evidence.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  server.close();
  await rm(data, { recursive: true, force: true });
  await writeFile(
    process.env.ROOMS_CLI_EVIDENCE ?? "/tmp/rooms-cli-compiled-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
}
