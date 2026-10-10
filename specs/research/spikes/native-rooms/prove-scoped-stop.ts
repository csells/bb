import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createNodeBbSdk } from "../../../../packages/sdk/src/node.ts";
import { createExperimentalRoomsClient } from "../../../../packages/sdk/src/rooms.ts";

const [previousEvidencePath, tokenPath, evidencePath] = process.argv.slice(2);
assert(previousEvidencePath && tokenPath && evidencePath);
const previous = JSON.parse(await readFile(previousEvidencePath, "utf8")) as {
  coreUrl: string;
  gatewayUrl: string;
  fixtureCreated: { threadId: string };
  existingThreadAttached: { roomId: string; agentId: string };
};
assert.equal(previous.coreUrl, "http://127.0.0.1:38896");
const bb = createNodeBbSdk({ baseUrl: previous.coreUrl });
const rooms = createExperimentalRoomsClient({
  baseUrl: previous.gatewayUrl,
  token: (await readFile(tokenPath, "utf8")).trim(),
});
const { threadId } = previous.fixtureCreated;
const { roomId, agentId } = previous.existingThreadAttached;
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  coreUrl: previous.coreUrl,
  roomId,
  agentId,
  threadId,
};
async function record(step: string, detail: unknown) {
  report[step] = detail;
  await writeFile(evidencePath, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  process.stdout.write(
    JSON.stringify({ step, at: new Date().toISOString() }) + "\n",
  );
}
async function history() {
  return bb.threads.events.list({
    threadId,
    order: "desc",
    limit: "100",
    types: ["turn/started", "turn/completed", "turn/input/accepted"],
  });
}
async function currentTurn() {
  const rows = await history();
  const accepted = rows.find(
    (event) =>
      event.type === "turn/input/accepted" && event.scope.kind === "turn",
  );
  if (accepted?.scope.kind !== "turn") return null;
  const turnId = accepted.scope.turnId;
  return rows.some(
    (event) =>
      event.type === "turn/completed" &&
      event.scope.kind === "turn" &&
      event.scope.turnId === turnId,
  )
    ? null
    : turnId;
}
async function until<T>(
  label: string,
  check: () => Promise<T | null>,
  timeout = 60_000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== null) return result;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Timed out: ${label}`);
}

try {
  const snapshot = await rooms.room(roomId);
  assert.equal(snapshot.room.paused, true);
  assert.equal(
    snapshot.agents.find((agent) => agent.id === agentId)?.threadId,
    threadId,
  );
  assert.equal(
    await currentTurn(),
    null,
    "Previous fixture still has native work",
  );
  const before = await bb.threads.get({ threadId });
  if (before.status === "active") await bb.threads.stop({ threadId });
  const oldCompletion = (await history()).find(
    (event) => event.type === "turn/completed" && event.scope.kind === "turn",
  );
  assert(oldCompletion?.scope.kind === "turn");
  const previousTurnId = oldCompletion.scope.turnId;
  await bb.threads.send({
    threadId,
    mode: "queue-if-active",
    input: [
      {
        type: "text",
        text: "This is an isolated BB Stop acceptance check unrelated to room work. Use your bash tool to run `sleep 45`, wait for it to finish, then reply only NATIVE_WAIT_DONE. Do not post to any room or change files.",
        mentions: [],
      },
    ],
  });
  const turnId = await until("new native turn admitted", async () => {
    const current = await currentTurn();
    return current &&
      current !== previousTurnId &&
      (await bb.threads.get({ threadId })).status === "active"
      ? current
      : null;
  });
  await record("nativeSuccessorAdmitted", { previousTurnId, turnId });
  const queued = await rooms.send(roomId, {
    requestId: randomUUID(),
    text: "Cancel this isolated queued request before it runs.",
    intent: "request",
    recipients: [agentId],
    replyTo: null,
  });
  assert(
    (await rooms.room(roomId)).deliveries.some(
      (delivery) =>
        delivery.messageId === queued.message.id &&
        delivery.agentId === agentId &&
        delivery.state === "queued",
    ),
  );
  await rooms.stop(roomId, agentId);
  assert.equal(await currentTurn(), turnId);
  assert.equal((await bb.threads.get({ threadId })).status, "active");
  await record("queuedRoomStop", {
    messageId: queued.message.id,
    preservedNativeTurn: true,
  });
  await bb.threads.stop({ threadId, expectedTurnId: previousTurnId });
  assert.equal(await currentTurn(), turnId);
  assert.equal((await bb.threads.get({ threadId })).status, "active");
  await record("staleScopedStop", { previousTurnId, preservedSuccessor: true });
  await bb.threads.stop({ threadId, expectedTurnId: turnId });
  const settled = await until(
    "matching scoped stop reaches idle",
    async () => {
      const thread = await bb.threads.get({ threadId });
      return thread.status === "idle" && (await currentTurn()) === null
        ? thread
        : null;
    },
    30_000,
  );
  const completion = (await history()).find(
    (event) =>
      event.type === "turn/completed" &&
      event.scope.kind === "turn" &&
      event.scope.turnId === turnId,
  );
  assert(completion?.type === "turn/completed");
  assert.equal(completion.data.status, "interrupted");
  for (const agent of snapshot.agents) await rooms.stop(roomId, agent.id);
  await record("matchingScopedStop", {
    turnId,
    providerCompletion: completion.data.status,
    nativeThreadStatus: settled.status,
  });
  await record("complete", {
    ok: true,
    providersCalledOnlyThroughBB: true,
    fixtureRoomPaused: true,
  });
} catch (error) {
  await record("failure", {
    message: error instanceof Error ? error.message : String(error),
  });
  throw error;
}
