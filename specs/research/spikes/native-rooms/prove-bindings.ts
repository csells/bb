import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createNodeBbSdk } from "../../../../packages/sdk/src/node.ts";
import { createExperimentalRoomsClient } from "../../../../packages/sdk/src/rooms.ts";

const [coreUrl, gatewayUrl, tokenFile, hostId, workspaceArg, evidenceArg] =
  process.argv.slice(2);
assert(
  coreUrl && gatewayUrl && tokenFile && hostId && workspaceArg && evidenceArg,
  "Usage: prove-bindings.ts CORE_URL GATEWAY_URL TOKEN_FILE HOST_ID WORKSPACE EVIDENCE",
);
assert.equal(new URL(coreUrl).hostname, "127.0.0.1");
assert.equal(
  new URL(coreUrl).port,
  "38896",
  "Proof must use the isolated candidate core",
);
const workspace = resolve(workspaceArg);
assert(workspace.startsWith("/Users/admin/rooms-native-qa/bindings-"));
assert.equal(
  (await stat(tokenFile)).mode & 0o077,
  0,
  "Room token must remain private",
);
const token = (await readFile(tokenFile, "utf8")).trim();
assert(token.length > 10);
const bb = createNodeBbSdk({ baseUrl: coreUrl });
const rooms = createExperimentalRoomsClient({ baseUrl: gatewayUrl, token });
assert.equal((await rooms.me()).access?.operator, true);
const host = await bb.hosts.get({ hostId });
assert(
  host.threadStorageRootPath?.startsWith("/Users/admin/rooms-native-qa/"),
  "Host execution storage must be in candidate QA data",
);
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  coreUrl,
  gatewayUrl,
  hostId,
  workspace,
};
async function record(step: string, data: unknown) {
  evidence[step] = data;
  await mkdir(dirname(resolve(evidenceArg)), { recursive: true });
  await writeFile(evidenceArg, JSON.stringify(evidence, null, 2) + "\n", {
    mode: 0o600,
  });
  process.stdout.write(
    JSON.stringify({ step, at: new Date().toISOString() }) + "\n",
  );
}
async function until<T>(
  description: string,
  check: () => Promise<T | null>,
  timeoutMs = 180_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== null) return value;
    await pause(1000);
  }
  throw new Error(`Timed out: ${description}`);
}
async function idle(threadId: string) {
  return until(`thread ${threadId} idle`, async () => {
    const thread = await bb.threads.get({ threadId });
    assert.notEqual(thread.status, "error", `Thread ${threadId} failed`);
    return thread.status === "idle" ? thread : null;
  });
}
async function activeTurn(threadId: string, previousTurnId: string | null) {
  return until(`native turn on ${threadId}`, async () => {
    const thread = await bb.threads.get({ threadId });
    assert.notEqual(thread.status, "error", `Thread ${threadId} failed`);
    const turnId = await runningTurnId(threadId);
    return thread.status === "active" && turnId && turnId !== previousTurnId
      ? turnId
      : null;
  });
}
const input = (text: string) => [{ type: "text" as const, text, mentions: [] }];
async function events(threadId: string) {
  const result: Awaited<ReturnType<typeof bb.threads.events.list>> = [];
  let afterSeq = "0";
  while (true) {
    const page = await bb.threads.events.list({
      threadId,
      limit: "100",
      order: "asc",
      afterSeq,
    });
    result.push(...page);
    if (page.length < 100) return result;
    afterSeq = String(page[page.length - 1].seq);
  }
}
async function runningTurnId(threadId: string) {
  const history = await events(threadId);
  const accepted = [...history]
    .reverse()
    .find(
      (event) =>
        event.type === "turn/input/accepted" && event.scope.kind === "turn",
    );
  if (accepted?.scope.kind !== "turn") return null;
  const turnId = accepted.scope.turnId;
  return history.some(
    (event) =>
      event.type === "turn/completed" &&
      event.scope.kind === "turn" &&
      event.scope.turnId === turnId,
  )
    ? null
    : turnId;
}
const longNativePrompt =
  "This is an isolated BB Stop acceptance check, unrelated to room work. Use your bash tool to run `sleep 45`, wait for it to finish, then reply with only NATIVE_WAIT_DONE. Do not post to any room or change files.";

try {
  await bb.files.mkdir({ hostId, path: workspace, recursive: true });
  const instructionsPath = join(workspace, "AGENTS.md");
  const instructions =
    "# Native binding acceptance fixture\n\nPreserve this file exactly. Give concise answers. Use room participation commands only when the current prompt supplies them. Never read or print credential file contents.\n";
  await bb.files.write({
    hostId,
    path: instructionsPath,
    content: instructions,
    createParents: true,
  });
  const agentsBefore = await bb.files.read({ hostId, path: instructionsPath });
  const project = await bb.projects.create({
    name: "Native rooms bindings acceptance",
    source: { type: "local_path", hostId, path: workspace },
  });
  const section = await bb.threadSections.create({
    name: "Bindings acceptance",
  });
  const existing = await bb.threads.spawn({
    projectId: project.id,
    providerId: "codex",
    reasoningLevel: "low",
    title: "Existing native thread for room binding",
    environment: {
      type: "host",
      hostId,
      workspace: { type: "unmanaged", path: workspace },
    },
    prompt:
      "This is an isolated BB room binding acceptance fixture. Reply only NATIVE_BINDING_READY. Do not use any tools or change any files.",
  });
  await record("fixtureCreated", {
    projectId: project.id,
    sectionId: section.id,
    threadId: existing.id,
  });
  const ready = await idle(existing.id);
  assert(ready.environmentId);
  const initialEvents = await events(existing.id);
  const initialOptions = await bb.threads.defaultExecutionOptions({
    threadId: existing.id,
  });
  const room = await rooms.create({
    name: "Native binding acceptance",
    projectId: project.id,
    defaultEnvironmentId: ready.environmentId,
    sectionId: section.id,
  });
  const attached = await rooms.addAgent(room.id, {
    handle: "existing",
    name: "Existing native thread",
    threadId: existing.id,
    instructions:
      "For this acceptance run, optional context needs no public reply. Only answer explicit requests addressed to you.",
  });
  assert.equal(attached.threadId, existing.id);
  assert.equal(attached.projectId, project.id);
  assert.equal(attached.environmentId, ready.environmentId);
  assert.deepEqual(
    await bb.threads.defaultExecutionOptions({ threadId: existing.id }),
    initialOptions,
  );
  assert.deepEqual(await events(existing.id), initialEvents);
  assert.deepEqual(
    await bb.files.read({ hostId, path: instructionsPath }),
    agentsBefore,
  );
  await assert.rejects(
    rooms.addAgent(room.id, {
      handle: "duplicate",
      name: "Duplicate",
      threadId: existing.id,
    }),
    /already|bound|binding/i,
  );
  await record("existingThreadAttached", {
    roomId: room.id,
    agentId: attached.id,
    threadId: existing.id,
    projectId: project.id,
    environmentId: ready.environmentId,
    providerId: ready.providerId,
    nativeOptionsSha256: digest(initialOptions),
    existingHistorySha256: digest(initialEvents),
    existingEventCount: initialEvents.length,
    agentsFileSha256: digest(agentsBefore),
    unchangedOptionsHistoryAndAgents: true,
    duplicateRejected: true,
  });
  const projectsBefore = (await bb.projects.list())
    .map((item) => item.id)
    .sort();
  const newAgents = [];
  for (const provider of ["codex", "claude-code"] as const) {
    newAgents.push(
      await rooms.addAgent(room.id, {
        handle: provider === "codex" ? "freshcodex" : "freshclaude",
        name: provider === "codex" ? "Fresh Codex" : "Fresh Claude",
        provider,
        instructions:
          "For this acceptance run, respond to explicit requests with one short public contribution via the supplied CLI. For optional context, finish silently with no public command.",
      }),
    );
  }
  const publication = await rooms.send(room.id, {
    requestId: randomUUID(),
    text: "Both requested participants: independently use your room command to publish one short sentence saying which perspective you bring to a shared task board. Do not mention or impersonate another participant. End your private turn after the command succeeds.",
    intent: "request",
    recipients: newAgents.map((agent) => agent.id),
    replyTo: null,
  });
  await record("providersRequested", {
    roomId: room.id,
    agents: newAgents.map(({ id, provider }) => ({ id, provider })),
    messageId: publication.message.id,
  });
  const completed = await until(
    "independent Codex and Claude public contributions",
    async () => {
      const snapshot = await rooms.room(room.id);
      for (const delivery of snapshot.deliveries)
        assert(
          !["error", "uncertain"].includes(delivery.state),
          delivery.error ?? "Room delivery failed",
        );
      return newAgents.every((agent) =>
        snapshot.messages.some(
          (message) =>
            message.kind === "agent" &&
            message.authorId === agent.id &&
            message.status === "complete",
        ),
      ) &&
        snapshot.deliveries.every((delivery) =>
          ["complete", "stopped"].includes(delivery.state),
        )
        ? snapshot
        : null;
    },
    300_000,
  );
  const bound = [];
  for (const participant of completed.agents) {
    assert(participant.threadId);
    const thread = await bb.threads.get({ threadId: participant.threadId });
    assert.equal(thread.projectId, project.id);
    assert.equal(thread.environmentId, ready.environmentId);
    assert.equal(thread.providerId, participant.provider);
    bound.push({
      agentId: participant.id,
      threadId: thread.id,
      providerId: thread.providerId,
      projectId: thread.projectId,
      environmentId: thread.environmentId,
    });
  }
  assert.deepEqual(
    (await bb.projects.list()).map((item) => item.id).sort(),
    projectsBefore,
  );
  assert.deepEqual(
    await bb.files.read({ hostId, path: instructionsPath }),
    agentsBefore,
  );
  assert.deepEqual(
    await bb.threads.defaultExecutionOptions({ threadId: existing.id }),
    initialOptions,
  );
  await record("independentParticipants", {
    bindings: bound,
    publicMessages: completed.messages.filter(
      (message) => message.kind === "agent",
    ),
    deliveries: completed.deliveries.map(({ id, agentId, state, outcome }) => ({
      id,
      agentId,
      state,
      outcome,
    })),
    projectIdsUnchanged: true,
    nativeSettingsAndAgentsFileUnchanged: true,
  });

  await rooms.policy(room.id, { paused: true, maxActivations: null });
  const oldEvents = await events(existing.id);
  const priorTurn = [...oldEvents]
    .reverse()
    .find(
      (event) => event.type === "turn/completed" && event.scope.kind === "turn",
    );
  assert(priorTurn?.scope.kind === "turn");
  const oldTurnId = priorTurn.scope.turnId;
  await bb.threads.send({
    threadId: existing.id,
    mode: "queue-if-active",
    input: input(longNativePrompt),
  });
  const independentTurnId = await activeTurn(existing.id, oldTurnId);
  const queued = await rooms.send(room.id, {
    requestId: randomUUID(),
    text: "This request will be cancelled for the isolated queued Stop check. Do not publish an answer.",
    intent: "request",
    recipients: [attached.id],
    replyTo: null,
  });
  const pending = await rooms.room(room.id);
  assert(
    pending.deliveries.some(
      (delivery) =>
        delivery.messageId === queued.message.id &&
        delivery.agentId === attached.id &&
        delivery.state === "queued",
    ),
  );
  await rooms.stop(room.id, attached.id);
  const stillActive = await bb.threads.get({ threadId: existing.id });
  assert.equal(await runningTurnId(existing.id), independentTurnId);
  assert.equal(stillActive.status, "active");
  await record("queuedRoomStopProtectedNativeWork", {
    threadId: existing.id,
    independentTurnId,
    cancelledRoomMessageId: queued.message.id,
    nativeStatusAfterRoomStop: stillActive.status,
  });
  await bb.threads.stop({ threadId: existing.id, expectedTurnId: oldTurnId });
  const afterStale = await bb.threads.get({ threadId: existing.id });
  assert.equal(await runningTurnId(existing.id), independentTurnId);
  assert.equal(afterStale.status, "active");
  await bb.threads.stop({
    threadId: existing.id,
    expectedTurnId: independentTurnId,
  });
  const afterMatch = await until(
    "matching scoped Stop retires intended turn",
    async () => {
      const thread = await bb.threads.get({ threadId: existing.id });
      return (await runningTurnId(existing.id)) !== independentTurnId &&
        !["active", "starting", "stopping"].includes(thread.status)
        ? thread
        : null;
    },
    30_000,
  );
  const stopEvents = await events(existing.id);
  assert(
    stopEvents.some(
      (event) =>
        event.type === "turn/completed" &&
        event.scope.kind === "turn" &&
        event.scope.turnId === independentTurnId,
    ),
  );
  for (const agent of newAgents) await rooms.stop(room.id, agent.id);
  assert.deepEqual(
    await bb.files.read({ hostId, path: instructionsPath }),
    agentsBefore,
  );
  await record("scopedNativeStop", {
    threadId: existing.id,
    staleExpectedTurnId: oldTurnId,
    successorTurnId: independentTurnId,
    staleStopPreservedSuccessor: true,
    matchingStopStatus: afterMatch.status,
    matchingTurnCompleted: true,
  });
  await record("complete", {
    verifiedAt: new Date().toISOString(),
    ok: true,
    fixtureRoomPaused: true,
    stableRuntimeUsed: false,
    providersCalledOnlyThroughBB: true,
  });
} catch (error) {
  await record("failure", {
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  });
  throw error;
}
