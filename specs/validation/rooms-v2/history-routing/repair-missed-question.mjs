import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RoomsStore } from "../../../../apps/rooms/src/store.ts";
const store = new RoomsStore("/Users/admin/rooms-v2-data/rooms.sqlite");
try {
  const result = store.transaction(() => {
    const roomId = "606b2f3e-4501-45f4-a4fd-83bae65f447a";
    const atlas = store.agent("94b11fb6-b685-4d40-be5d-e3f5774c6f8a");
    const question = store.message("4bedefa9-b54a-4565-8e7c-77798867baee");
    assert.equal(atlas.roomId, roomId);
    assert.equal(atlas.handle, "atlas");
    assert.equal(question.roomId, roomId);
    assert.equal(question.authorId, "c080caf1-25a0-444c-a671-fcd241963482");
    assert.equal(question.status, "complete");
    assert.equal(question.intent, "post");
    assert.match(question.text, /A question for the room/);
    assert.equal(store.work().filter((d) => d.roomId === roomId).length, 0);
    assert.equal(store.deliveries(roomId).filter((d) => d.messageId === question.id && d.agentId === atlas.id).length, 0);
    assert.equal(store.room(roomId).paused, false);
    const digest = () => createHash("sha256").update(JSON.stringify(store.messages(roomId))).digest("hex");
    const historyBefore = digest();
    store.enqueue(atlas.id, question, "notice");
    assert.equal(digest(), historyBefore);
    const delivery = store.deliveries(roomId).find((d) => d.messageId === question.id && d.agentId === atlas.id);
    assert.equal(delivery.intent, "notice");
    return { repairedAt: new Date().toISOString(), roomId, questionId: question.id, agentId: atlas.id, deliveryId: delivery.id, intent: delivery.intent, existingHistorySHA256: historyBefore, historyUnchanged: true };
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally { store.close(); }
