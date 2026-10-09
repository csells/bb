import { createNodeBbSdk } from "@bb/sdk";
import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";

const packageRoot = resolve(import.meta.dirname, "..");
const data = await mkdtemp(join(tmpdir(), "rooms-runtime-acceptance-"));
const port = Number(process.env.ROOMS_ACCEPTANCE_PORT ?? "38906");
const origin = `http://127.0.0.1:${port}`;
const provider = process.env.ROOMS_TEST_PROVIDER ?? "pi";
const controlled = process.env.ROOMS_ACCEPTANCE_CONTROLLED === "1";
const streamOnly = process.env.ROOMS_ACCEPTANCE_STREAM_ONLY === "1";
if (controlled && streamOnly)
  throw new Error(
    "Controlled and natural stream-only modes are mutually exclusive",
  );
const model =
  process.env.ROOMS_TEST_MODEL ?? "rooms-local/qwen2.5:7b-instruct-q4_K_M";
const output =
  process.env.ROOMS_ACCEPTANCE_EVIDENCE ?? join(data, "evidence.json");
const sdk = createNodeBbSdk({
  baseUrl: process.env.ROOMS_BB_URL ?? "http://127.0.0.1:38886",
});
const evidence = {
  started: new Date().toISOString(),
  model,
  provider,
  scope: streamOnly
    ? "fresh-agent natural streaming"
    : controlled
      ? "controlled runtime lifecycle"
      : "full natural participation",
  qualification: controlled
    ? "controlled runtime fixture, not autonomous model qualification"
    : "natural model participation",
  checks: [],
  observations: [],
  privateTurns: {},
  dataDirectory: data,
};
let server;
let roomId;
let cookie;
const threadIds = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(condition, name) {
  if (!condition) throw new Error(name);
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function request(path, body, session = cookie) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Rooms-Request": "1",
      ...(session ? { Cookie: session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(`${path} ${response.status} ${JSON.stringify(value)}`);
  return { value, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function start() {
  const log = createWriteStream(join(data, "gateway.log"), { flags: "a" });
  await once(log, "open");
  server = spawn(process.execPath, [join(packageRoot, "dist/server.js")], {
    cwd: packageRoot,
    env: {
      ...process.env,
      ROOMS_DATA_DIR: data,
      ROOMS_PUBLIC_ORIGIN: origin,
      ROOMS_PORT: String(port),
      ROOMS_BIND_HOST: "127.0.0.1",
    },
    stdio: ["ignore", log, log],
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error(
        "Gateway startup failed: " +
          (await readFile(join(data, "gateway.log"), "utf8")),
      );
    try {
      if ((await fetch(origin + "/health")).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("Gateway health timed out");
}
async function stopServer() {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
}
const snapshot = async () => (await request(`/api/rooms/${roomId}`)).value;
const send = async (text, recipients, session = cookie, intent = "request") =>
  (
    await request(
      `/api/rooms/${roomId}/messages`,
      {
        text,
        recipients,
        intent,
        replyTo: null,
        requestId: crypto.randomUUID(),
      },
      session,
    )
  ).value.message;
async function waitComplete(messageId, timeout = 300000) {
  const deadline = Date.now() + timeout;
  const seen = new Map();
  let last;
  while (Date.now() < deadline) {
    last = await snapshot();
    for (const agent of last.agents)
      if (agent.threadId) threadIds.add(agent.threadId);
    for (const message of last.messages.filter(
      (m) => m.kind === "agent" && m.status === "streaming",
    )) {
      const lengths = seen.get(message.id) ?? new Set();
      lengths.add(message.text.length);
      seen.set(message.id, lengths);
    }
    const deliveries = last.deliveries.filter(
      (d) =>
        d.messageId === messageId ||
        d.createdAt >= last.messages.find((m) => m.id === messageId).createdAt,
    );
    const failed = deliveries.find(
      (d) =>
        ["error", "uncertain"].includes(d.state) ||
        (d.state !== "stopped" && d.error !== null),
    );
    if (failed) throw new Error("Delivery failed: " + failed.error);
    if (
      deliveries.length &&
      deliveries.every((d) => ["complete", "stopped"].includes(d.state))
    ) {
      evidence.observations.push({
        messageId,
        streamedLengths: Object.fromEntries(
          [...seen].map(([id, values]) => [id, [...values]]),
        ),
        deliveries,
      });
      return last;
    }
    await sleep(300);
  }
  throw new Error(
    "Conversation did not settle: " + JSON.stringify(last?.deliveries),
  );
}
const flatten = (rows) =>
  rows.flatMap((row) => [row, ...flatten(row.children ?? [])]);
async function pendingCommand(agentId, needle) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = await snapshot(),
      agent = state.agents.find((a) => a.id === agentId);
    if (agent.threadId) {
      threadIds.add(agent.threadId);
      const timeline = await sdk.threads.timeline({
        threadId: agent.threadId,
        includeNestedRows: "true",
        segmentLimit: "20",
      });
      if (
        flatten(timeline.rows).some(
          (row) =>
            row.kind === "work" &&
            row.status === "pending" &&
            row.command?.includes(needle),
        )
      )
        return { state, agent };
    }
    await sleep(300);
  }
  throw new Error("Agent did not start expected real tool: " + needle);
}
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function fixtureCommand(agent, statements) {
  const pattern = join(
    data,
    "workspaces",
    roomId,
    agent.id,
    ".rooms",
    "participate-*",
  );
  const script = `import glob,os,subprocess,json,time;cmd=max(glob.glob(${JSON.stringify(pattern)}),key=lambda p:os.stat(p).st_mtime_ns);${statements}`;
  const file = join(data, "fixture-" + crypto.randomUUID() + ".py");
  writeFileSync(file, script, { mode: 0o600 });
  return "/usr/bin/python3 " + shellQuote(file);
}
function fixturePost(agent, text) {
  return fixtureCommand(
    agent,
    `subprocess.run([cmd,"post","--text",${JSON.stringify(text)}],check=True)`,
  );
}
function fixturePrompt(command) {
  return `Run this controlled integration fixture by executing exactly ONE bash tool command, preserving all quoting and sequencing:
${command}
After success respond privately with exactly CONTROLLED_PRIVATE_FINAL Reviewer: fixture @builder. Do not publish that private final.`;
}

try {
  await start();
  const password = crypto.randomUUID() + crypto.randomUUID();
  const owner = await request(
    "/api/auth/register",
    {
      invite: await readFile(join(data, "owner-invite"), "utf8"),
      name: "Alex",
      handle: "alex",
      password,
    },
    null,
  );
  cookie = owner.cookie;
  roomId = (await request("/api/me")).value.rooms[0].id;
  const invite = (await request(`/api/rooms/${roomId}/invites`, {})).value
    .invite;
  const other = await request(
    "/api/auth/register",
    { invite, name: "Blair", handle: "blair", password },
    null,
  );
  check(
    owner.value.user.id !== other.value.user.id,
    "two independently authenticated human participants",
  );
  const builder = (
    await request(`/api/rooms/${roomId}/agents`, {
      handle: "builder",
      name: "Builder",
      provider,
      model,
      instructions:
        "You bring a practical perspective to open conversation. You may agree, disagree, ask another participant, or decide no response is needed. Speak through the room CLI.",
    })
  ).value;
  const reviewer = (
    await request(`/api/rooms/${roomId}/agents`, {
      handle: "reviewer",
      name: "Reviewer",
      provider,
      model,
      instructions:
        "You bring an independent reflective perspective. You may agree, disagree, ask another participant, or decide no response is needed. Speak through the room CLI.",
    })
  ).value;
  scenarios: {
    let state;
    if (!streamOnly) {
      const peerFixture = fixturePrompt(
        fixturePost(reviewer, "CONTROLLED_PEER_REPLY"),
      );
      const firstFixture = fixturePrompt(
        fixtureCommand(
          builder,
          `subprocess.run([cmd,"request","--to","@reviewer","--text",${JSON.stringify(peerFixture)}],check=True)`,
        ),
      );
      const first = await send(
        controlled
          ? firstFixture
          : "Give your own short view on whether life's meaning comes more from relationships or achievement, then ask Reviewer for a contrasting view. Reviewer should give their own answer and ask Builder one follow-up. Builder should answer it and ask Reviewer one final question. Reviewer should answer that final question, then both of you can let the discussion rest.",
        [builder.id],
      );
      state = await waitComplete(first.id);
      const discussion = state.messages.filter((m) => m.kind === "agent");
      check(
        discussion.some((m) => m.authorId === builder.id) &&
          discussion.some((m) => m.authorId === reviewer.id),
        controlled
          ? "two real independent agents executed explicit publication fixtures"
          : "independent real agents chose and published their own contributions",
      );
      if (!controlled)
        check(
          state.deliveries.length >= 4,
          "a real discussion continued beyond two peer handoffs before becoming idle",
        );
      for (const agent of state.agents) {
        const thread = await sdk.threads.get({ threadId: agent.threadId });
        check(
          thread.parentThreadId === null,
          agent.name + " runs in a top-level BB thread",
        );
        evidence.privateTurns[agent.handle] = await sdk.threads.timeline({
          threadId: agent.threadId,
          includeNestedRows: "true",
          segmentLimit: "100",
        });
      }
      if (controlled)
        check(
          Object.values(evidence.privateTurns).some((timeline) =>
            flatten(timeline.rows).some(
              (row) =>
                row.kind === "conversation" &&
                row.role === "assistant" &&
                row.text.includes("CONTROLLED_PRIVATE_FINAL"),
            ),
          ),
          "controlled model actually emitted private labeled-other-agent text",
        );
      const beforeSilence = state.messages.filter(
        (m) => m.kind === "agent",
      ).length;
      const notice = await send(
        "Just recording that I read the discussion. No reply or acknowledgement is wanted; please leave this notice unanswered.",
        [builder.id],
        other.cookie,
        "notice",
      );
      state = await waitComplete(notice.id);
      check(
        state.messages.filter((m) => m.kind === "agent").length ===
          beforeSilence,
        "a second human notice can complete with successful no-reply silence",
      );
    }
    const streamFixture = fixturePrompt(
      fixtureCommand(
        builder,
        `message=json.loads(subprocess.check_output([cmd,"stream","begin"]))["messageId"];subprocess.run([cmd,"stream","append","--message",message,"--sequence","0","--text","Controlled first chunk. "],check=True);time.sleep(1);subprocess.run([cmd,"stream","append","--message",message,"--sequence","1","--text","Controlled second chunk. "],check=True);time.sleep(1);subprocess.run([cmd,"stream","append","--message",message,"--sequence","2","--text","Controlled third chunk."],check=True);subprocess.run([cmd,"stream","commit","--message",message],check=True)`,
      ),
    );
    const story = await send(
      controlled
        ? streamFixture
        : "Write an original three-paragraph miniature story about a lighthouse keeper finding a surprising letter. Let me read each paragraph as you compose it: explicitly begin one public stream, compose and append the first paragraph, then compose and append the next, then the final paragraph, and commit. Use separate append tool calls; do not write the whole story first and replay it. No need to ask another agent.",
      [builder.id],
      other.cookie,
    );
    state = await waitComplete(story.id);
    const stream = evidence.observations.at(-1).streamedLengths;
    check(
      Object.values(stream).some(
        (lengths) => lengths.filter((n) => n > 0).length >= 2,
      ),
      controlled
        ? "scripted public chunks executed by real model tool produced observable stream revisions"
        : "model-authored public text grew across separately observed stream revisions",
    );
    const builderThread = state.agents.find(
      (a) => a.id === builder.id,
    ).threadId;
    const storyTimeline = await sdk.threads.timeline({
      threadId: builderThread,
      includeNestedRows: "true",
      segmentLimit: "100",
    });
    evidence.privateTurns.story = storyTimeline;
    const appendCalls = flatten(storyTimeline.rows).filter(
      (r) => r.kind === "work" && r.command?.includes("stream append"),
    );
    if (!controlled)
      check(
        appendCalls.length >= 3,
        "the real model made at least three explicit public append tool calls",
      );
    if (streamOnly) {
      evidence.finalSnapshot = state;
      evidence.finished = new Date().toISOString();
      break scenarios;
    }
    const recovery = await send(
      controlled
        ? fixturePrompt(
            "sleep 20 && " + fixturePost(builder, "RECOVERY_SUCCESS"),
          )
        : "For a restart-resilience check, run the shell command sleep 20, then publish one short room message saying RECOVERY_SUCCESS. Do not publish before the sleep completes.",
      [builder.id],
    );
    const running = await pendingCommand(builder.id, "sleep 20");
    const originalDelivery = running.state.deliveries.find(
      (d) => d.messageId === recovery.id,
    );
    await stopServer();
    await start();
    state = await waitComplete(recovery.id);
    check(
      state.deliveries.find((d) => d.id === originalDelivery.id)?.threadId ===
        originalDelivery.threadId,
      "gateway restart reattached the same accepted activation and BB thread",
    );
    check(
      state.messages.filter(
        (m) => m.kind === "agent" && m.text.includes("RECOVERY_SUCCESS"),
      ).length === 1,
      "gateway restart produced one explicit publication without replaying execution",
    );
    const steerTask = await send(
      controlled
        ? fixturePrompt(
            "sleep 20 && " + fixturePost(builder, "CONTROLLED_BEFORE_STEER"),
          )
        : "For an input-steering check, run shell sleep 20 before publishing a short observation about teamwork. While the tool is running a human may provide new information; take that into account if it arrives.",
      [builder.id],
    );
    await pendingCommand(builder.id, "sleep 20");
    const steerText = controlled
      ? fixturePrompt(fixturePost(builder, "LIGHTHOUSE_TEAM"))
      : "New information: our team's shared goal is restoring the lighthouse. Please include LIGHTHOUSE_TEAM in your public observation so I can tell this input reached you.";
    const steerReceipt = await request(
      `/api/rooms/${roomId}/agents/${builder.id}/steer`,
      { text: steerText },
      other.cookie,
    );
    evidence.observations.push({
      steerHttpReceipt: steerReceipt.value,
      acceptedAt: new Date().toISOString(),
    });
    state = await waitComplete(steerTask.id);
    check(
      state.messages.some((m) => m.kind === "human" && m.text === steerText),
      "second human steering input is durably visible in the room",
    );
    check(
      state.messages.some(
        (m) => m.kind === "agent" && m.text.includes("LIGHTHOUSE_TEAM"),
      ),
      "real running agent observed native steering and explicitly published its effect",
    );
    evidence.privateTurns.steer = await sdk.threads.timeline({
      threadId: builderThread,
      includeNestedRows: "true",
      segmentLimit: "100",
    });
    const cancellation = await send(
      controlled
        ? fixturePrompt(
            "sleep 30 && " + fixturePost(builder, "SHOULD_NOT_PUBLISH"),
          )
        : "For a cancellation check, first run shell sleep 30, then publish SHOULD_NOT_PUBLISH. Wait until the command completes before doing anything public.",
      [builder.id],
    );
    const pending = await pendingCommand(builder.id, "sleep 30");
    const canceledDelivery = pending.state.deliveries.find(
      (d) => d.messageId === cancellation.id,
    );
    const cap = JSON.parse(
      await readFile(
        join(
          data,
          "workspaces",
          roomId,
          builder.id,
          ".rooms",
          "activations",
          canceledDelivery.activationId + ".json",
        ),
        "utf8",
      ),
    );
    await request(`/api/rooms/${roomId}/agents/${builder.id}/stop`, {});
    const stale = await fetch(origin + "/api/agent/commands", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + cap.token,
        "Content-Type": "application/json",
        "X-Rooms-Request": "1",
      },
      body: JSON.stringify({
        operation: "post",
        requestId: crypto.randomUUID(),
        args: {
          text: "SHOULD_NOT_PUBLISH",
          intent: "post",
          recipients: [],
          replyTo: null,
        },
      }),
    });
    check(
      stale.status === 403,
      "stopped real activation rejects a delayed authenticated publisher",
    );
    state = await waitComplete(cancellation.id);
    check(
      !state.messages.some(
        (m) => m.kind === "agent" && m.text.includes("SHOULD_NOT_PUBLISH"),
      ),
      "canceled real execution published no final output",
    );
    if (controlled) {
      const privateFinals = Object.values(evidence.privateTurns).flatMap(
        (timeline) =>
          flatten(timeline.rows)
            .filter(
              (row) =>
                row.kind === "conversation" &&
                row.role === "assistant" &&
                row.text.includes("CONTROLLED_PRIVATE_FINAL"),
            )
            .map((row) => row.text.trim()),
      );
      check(
        privateFinals.length > 0 &&
          !state.messages.some(
            (message) =>
              message.kind === "agent" &&
              privateFinals.includes(message.text.trim()),
          ),
        "actual private finals containing another agent label and mention never became room messages",
      );
    }
    evidence.finalSnapshot = state;
    evidence.finished = new Date().toISOString();
  }
} catch (error) {
  evidence.error = String(error);
  if (roomId) {
    try {
      evidence.finalSnapshot = await snapshot();
      for (const agent of evidence.finalSnapshot.agents)
        if (agent.threadId) {
          threadIds.add(agent.threadId);
          evidence.privateTurns["failure-" + agent.handle] =
            await sdk.threads.timeline({
              threadId: agent.threadId,
              includeNestedRows: "true",
              segmentLimit: "100",
            });
        }
    } catch (inspectionError) {
      evidence.inspectionError = String(inspectionError);
    }
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopServer();
  for (const threadId of threadIds) {
    try {
      const thread = await sdk.threads.get({ threadId });
      if (!["idle", "error", "stopped"].includes(thread.status))
        await sdk.threads.stop({ threadId });
      await sdk.threads.archive({ threadId });
    } catch (error) {
      evidence.observations.push({ cleanupError: String(error), threadId });
    }
  }
  let serialized = JSON.stringify(evidence, null, 2);
  if (roomId && evidence.finalSnapshot)
    for (const agent of evidence.finalSnapshot.agents) {
      const credentials = join(
        data,
        "workspaces",
        roomId,
        agent.id,
        ".rooms",
        "activations",
      );
      let files;
      try {
        files = await readdir(credentials);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        files = [];
      }
      for (const file of files) {
        const cap = JSON.parse(await readFile(join(credentials, file), "utf8"));
        serialized = serialized.replaceAll(
          cap.token,
          "<redacted activation credential>",
        );
      }
    }
  await writeFile(output, serialized);
  await rm(join(data, "owner-invite"), { force: true });
  await rm(join(data, "workspaces"), { recursive: true, force: true });
  console.log("Evidence: " + output);
}
