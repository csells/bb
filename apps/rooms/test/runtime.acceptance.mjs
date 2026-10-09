import { createNodeBbSdk } from "@bb/sdk";
import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { steeringFaultProxy } from "./steering-fault-proxy.mjs";

const packageRoot = resolve(import.meta.dirname, "..");
const data = await mkdtemp(join(tmpdir(), "rooms-runtime-acceptance-"));
const port = Number(process.env.ROOMS_ACCEPTANCE_PORT ?? "38906");
const origin = `http://127.0.0.1:${port}`;
const provider = process.env.ROOMS_TEST_PROVIDER ?? "pi";
const steeringFault = process.env.ROOMS_TEST_STEERING_FAULT ?? null;
if (
  steeringFault !== null &&
  ![
    "drop-before",
    "crash-before",
    "drop-after",
    "delay-after",
    "native-interrupt",
  ].includes(steeringFault)
)
  throw new Error("Invalid steering fault mode");
const proxy = steeringFault
  ? await steeringFaultProxy(
      process.env.ROOMS_BB_URL ?? "http://127.0.0.1:38886",
      steeringFault,
    )
  : null;
const controlled = process.env.ROOMS_ACCEPTANCE_CONTROLLED === "1";
const streamOnly = process.env.ROOMS_ACCEPTANCE_STREAM_ONLY === "1";
if (controlled && streamOnly)
  throw new Error(
    "Controlled and natural stream-only modes are mutually exclusive",
  );
const model =
  process.env.ROOMS_TEST_MODEL ??
  (provider === "pi" ? "rooms-local/qwen2.5:7b-instruct-q4_K_M" : null);
const steering =
  process.env.ROOMS_TEST_STEERING ??
  (["pi", "codex", "claude-code"].includes(provider) ? "native" : "queue");
if (!["native", "queue"].includes(steering))
  throw new Error("ROOMS_TEST_STEERING must be native or queue");
const output =
  process.env.ROOMS_ACCEPTANCE_EVIDENCE ?? join(data, "evidence.json");
const sdk = createNodeBbSdk({
  baseUrl: process.env.ROOMS_BB_URL ?? "http://127.0.0.1:38886",
});
const evidence = {
  started: new Date().toISOString(),
  model,
  provider,
  steering,
  steeringFault,
  scope: steeringFault
    ? "actual native input lifecycle fault"
    : streamOnly
      ? "fresh-agent natural streaming"
      : controlled
        ? "controlled runtime lifecycle"
        : "full natural participation",
  qualification:
    controlled || steeringFault
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
async function request(path, body, session = cookie, expectedStatus) {
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
  if (
    expectedStatus === undefined
      ? !response.ok
      : response.status !== expectedStatus
  )
    throw new Error(`${path} ${response.status} ${JSON.stringify(value)}`);
  return {
    value,
    status: response.status,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function start() {
  const log = createWriteStream(join(data, "gateway.log"), { flags: "a" });
  await once(log, "open");
  server = spawn(
    process.execPath,
    [
      process.env.ROOMS_ACCEPTANCE_SERVER_ENTRY ??
        join(packageRoot, "dist/server.js"),
    ],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        ROOMS_DATA_DIR: data,
        ROOMS_PUBLIC_ORIGIN: origin,
        ROOMS_PORT: String(port),
        ROOMS_BIND_HOST: "127.0.0.1",
        ...(proxy ? { ROOMS_BB_URL: proxy.url } : {}),
      },
      stdio: ["ignore", log, log],
    },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null)
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
async function stopServer(signal = "SIGTERM") {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill(signal);
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
async function pendingPublication(agentId, messageId) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const state = await snapshot();
    const delivery = state.deliveries.find(
      (item) => item.messageId === messageId && item.agentId === agentId,
    );
    const agent = state.agents.find((item) => item.id === agentId);
    const message = state.messages.find(
      (item) =>
        item.authorId === agentId &&
        item.causeId === messageId &&
        item.status === "streaming" &&
        item.text.length > 0,
    );
    if (message && delivery.state === "running" && agent.threadId) {
      threadIds.add(agent.threadId);
      const thread = await sdk.threads.get({ threadId: agent.threadId });
      if (thread.status === "active") return { state, agent, message };
    }
    await sleep(100);
  }
  throw new Error(
    "Agent did not begin an active authored public stream for cancellation",
  );
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
    if (steeringFault) {
      const first = await send(
        "For a transport recovery test, run shell sleep 20, then finish privately without posting anything to the room.",
        [builder.id],
      );
      const pending = await pendingCommand(builder.id, "sleep 20");
      const initial = pending.state.deliveries.find(
        (delivery) => delivery.messageId === first.id,
      );
      if (steeringFault === "native-interrupt") {
        const followUp = await send(
          "No public response is needed; this independently queued request should run after the earlier native execution ends.",
          [builder.id],
          other.cookie,
        );
        check(
          (await snapshot()).deliveries.find(
            (delivery) => delivery.messageId === followUp.id,
          )?.state === "queued",
          "second human input is queued while the first native execution is active",
        );
        await sdk.threads.stop({ threadId: initial.threadId });
        state = await waitComplete(followUp.id);
        check(
          state.deliveries.find(
            (delivery) => delivery.messageId === followUp.id,
          )?.state === "complete",
          "ordinary native interruption preserves and executes separately queued human input",
        );
        check(
          state.deliveries.find((delivery) => delivery.id === initial.id)
            ?.state === "stopped",
          "ordinary native interruption fences only its own active execution",
        );
        check(
          !state.messages.some((message) => message.kind === "agent"),
          "native interruption recovery does not publish private provider output",
        );
        evidence.privateTurns.fault = await sdk.threads.timeline({
          threadId: initial.threadId,
          includeNestedRows: "true",
          segmentLimit: "100",
        });
        evidence.finalSnapshot = state;
        evidence.finished = new Date().toISOString();
        break scenarios;
      }
      const steeringCall = request(
        `/api/rooms/${roomId}/agents/${builder.id}/steer`,
        {
          text: "Transport recovery observation: remember DELAYED_STEERING_INPUT privately; do not publish or ask anyone.",
        },
        other.cookie,
      ).then(
        (receipt) => ({ status: receipt.status }),
        (error) => ({ error: String(error) }),
      );
      const submitted = await proxy.intercepted;
      evidence.observations.push({
        fault: steeringFault,
        interceptedAt: new Date().toISOString(),
      });
      if (steeringFault === "crash-before") await stopServer("SIGKILL");
      if (steeringFault !== "delay-after") await steeringCall;
      const deadline = Date.now() + 120000;
      while (true) {
        const thread = await sdk.threads.get({ threadId: initial.threadId });
        if (["idle", "error", "stopped"].includes(thread.status)) break;
        if (Date.now() >= deadline)
          throw new Error(
            "Original native execution did not settle after steering fault",
          );
        await sleep(100);
      }
      if (server.exitCode !== null || server.signalCode !== null) await start();
      await sleep(1600);
      state = await snapshot();
      check(
        state.deliveries.find((delivery) => delivery.id === initial.id)
          ?.state ===
          (steeringFault === "delay-after" ? "running" : "uncertain"),
        steeringFault === "delay-after"
          ? "known in-flight steering retains its active lease without fencing during a delayed successful acknowledgment"
          : steeringFault === "crash-before"
            ? "lost steering acknowledgment remains uncertain after actual gateway crash and restart"
            : "lost steering acknowledgment remains uncertain after original native completion",
      );
      const next = await send(
        "No public response is needed; this is a queued follow-up after recovery.",
        [builder.id],
        other.cookie,
      );
      await sleep(700);
      state = await snapshot();
      check(
        state.deliveries.find((delivery) => delivery.messageId === next.id)
          ?.state === "queued",
        "a later human request cannot acquire the agent while a steering dispatch remains unresolved",
      );
      if (steeringFault === "drop-before" || steeringFault === "crash-before") {
        await request(
          `/api/rooms/${roomId}/agents/${builder.id}/recover`,
          {},
          cookie,
          409,
        );
        check(
          (await snapshot()).deliveries.find(
            (delivery) => delivery.id === initial.id,
          )?.state === "uncertain",
          "idle native execution cannot resolve a steering input that has no exact admission receipt",
        );
      }
      const forwarded = await proxy.release();
      evidence.observations.push({
        forwarded,
        releasedAt: new Date().toISOString(),
      });
      if (steeringFault === "delay-after") {
        const receipt = await steeringCall;
        check(
          receipt.status === 200,
          "delayed successful native steering acknowledgment is accepted without revoking its capability",
        );
        state = await waitComplete(first.id);
        check(
          state.deliveries.find((delivery) => delivery.id === initial.id)
            ?.state === "complete" &&
            state.deliveries.find((delivery) => delivery.messageId === next.id)
              ?.state === "complete",
          "the original activation settles and its queued follow-up runs after the exact delayed acknowledgment",
        );
        evidence.finalSnapshot = state;
        evidence.finished = new Date().toISOString();
        break scenarios;
      }
      const terminalDeadline = Date.now() + 120000;
      let matched = false;
      while (Date.now() < terminalDeadline) {
        const events = [];
        for (let afterSeq = "0"; ;) {
          const page = await sdk.threads.events.list({
            threadId: initial.threadId,
            afterSeq,
            order: "asc",
            limit: "100",
          });
          events.push(...page);
          if (page.length < 100) break;
          afterSeq = String(page.at(-1).seq);
        }
        const nativeText = submitted.input.find(
          (part) => part.type === "text",
        ).text;
        const actual = events.find(
          (event) =>
            event.type === "client/turn/requested" &&
            event.data.input.some(
              (part) => part.type === "text" && part.text === nativeText,
            ),
        );
        const thread = await sdk.threads.get({ threadId: initial.threadId });
        matched = Boolean(actual);
        if (matched && ["idle", "error", "stopped"].includes(thread.status))
          break;
        if (!matched && forwarded.status >= 400) break;
        await sleep(100);
      }
      if (matched) {
        await request(`/api/rooms/${roomId}/agents/${builder.id}/recover`, {});
        state = await waitComplete(next.id);
        check(
          state.deliveries.find((delivery) => delivery.id === initial.id)
            ?.state === "stopped",
          "only exact terminal native steering evidence permits owner recovery without replay",
        );
        check(
          state.deliveries.find((delivery) => delivery.messageId === next.id)
            ?.state === "complete",
          "the independently queued human follow-up executes only after confirmed recovery",
        );
      } else {
        await request(
          `/api/rooms/${roomId}/agents/${builder.id}/recover`,
          {},
          cookie,
          409,
        );
        state = await snapshot();
        check(
          state.deliveries.find((delivery) => delivery.id === initial.id)
            ?.state === "uncertain",
          "a late native rejection without durable admission proof remains fenced rather than guessing completion",
        );
      }
      check(
        !state.messages.some((message) => message.kind === "agent"),
        "private fault-recovery execution creates no public transcript messages",
      );
      evidence.privateTurns.fault = await sdk.threads.timeline({
        threadId: initial.threadId,
        includeNestedRows: "true",
        segmentLimit: "100",
      });
      evidence.finalSnapshot = state;
      evidence.finished = new Date().toISOString();
      break scenarios;
    }
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
    if (steering === "native") {
      const steerReceipt = await request(
        `/api/rooms/${roomId}/agents/${builder.id}/steer`,
        { text: steerText },
        other.cookie,
      );
      evidence.observations.push({
        steerHttpReceipt: steerReceipt.value,
        acceptedAt: new Date().toISOString(),
      });
      check(
        steerReceipt.value.accepted === true &&
          steerReceipt.value.delivery === "sent",
        "native steering returns a sent receipt rather than only queued acceptance",
      );
    } else {
      const rejected = await request(
        `/api/rooms/${roomId}/agents/${builder.id}/steer`,
        { text: steerText },
        other.cookie,
        409,
      );
      evidence.observations.push({
        unsupportedSteerReceipt: {
          status: rejected.status,
          body: rejected.value,
        },
      });
      const afterRejection = await snapshot();
      check(
        !afterRejection.messages.some(
          (message) => message.kind === "human" && message.text === steerText,
        ),
        "unsupported live steering is explicitly rejected without claiming accepted input",
      );
      const followUp = await send(steerText, [builder.id], other.cookie);
      const queued = await snapshot();
      check(
        queued.deliveries.some(
          (delivery) =>
            delivery.messageId === followUp.id && delivery.state === "queued",
        ) &&
          queued.deliveries.some(
            (delivery) =>
              delivery.messageId === steerTask.id &&
              delivery.state === "running",
          ),
        "second human follow-up is durably queued while the actual provider tool is running",
      );
      evidence.observations.push({
        queuedFollowUp: {
          messageId: followUp.id,
          acceptedAt: new Date().toISOString(),
        },
      });
    }
    state = await waitComplete(steerTask.id);
    check(
      state.messages.some((m) => m.kind === "human" && m.text === steerText),
      steering === "native"
        ? "second human steering input is durably visible in the room"
        : "second human queued follow-up is durably visible in the room",
    );
    check(
      state.messages.some(
        (m) => m.kind === "agent" && m.text.includes("LIGHTHOUSE_TEAM"),
      ),
      steering === "native"
        ? "real running agent observed native steering and explicitly published its effect"
        : "real agent later observed its queued follow-up and explicitly published its effect",
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
        : "For a cancellation check, begin one public stream and compose twenty short original paragraphs about restoring a lighthouse, with each paragraph in its own separate append tool call. Develop the paragraphs one at a time. Only after all twenty paragraphs are appended and the stream is committed, publish a separate message SHOULD_NOT_PUBLISH. A human will use Stop while you are composing; do not finish early or pre-compose all the paragraphs in one command.",
      [builder.id],
    );
    const pending = controlled
      ? await pendingCommand(builder.id, "sleep 30")
      : await pendingPublication(builder.id, cancellation.id);
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
    if (!controlled)
      check(
        state.messages.find((message) => message.id === pending.message.id)
          ?.status === "stopped",
        "Stop preserves selected partial text as an aborted stream while real composition is active",
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
  await proxy?.close();
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
