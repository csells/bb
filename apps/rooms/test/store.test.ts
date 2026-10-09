import { describe, it, expect, afterEach } from "vitest";
import { RoomsStore } from "../src/store.js";
const stores: RoomsStore[] = [];
function fixture() {
  const s = new RoomsStore(":memory:");
  stores.push(s);
  const room = s.createRoom("Workshop", "");
  const invite = s.invite(room.id, "owner");
  const owner = s.register(invite, "chris", "Chris", "correct horse battery");
  return { s, room, owner, invite };
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));
describe("separate humans and durable room state", () => {
  it("atomically consumes invites and binds sessions to distinct identities", () => {
    const { s, room, owner, invite } = fixture();
    expect(() => s.register(invite, "eve", "Eve", "password12345")).toThrow();
    const guest = s.register(
      s.invite(room.id),
      "alex",
      "Alex",
      "password12345",
    );
    expect(s.authenticate(s.session(owner.id)).id).toBe(owner.id);
    expect(s.authenticate(s.session(guest.id)).id).toBe(guest.id);
    expect(() => s.membership(room.id, guest.id, true)).toThrow();
    expect(s.members(room.id)).toHaveLength(2);
  });
  it("rejects revoked room access without invalidating other memberships", () => {
    const { s, room } = fixture();
    const guest = s.register(
      s.invite(room.id),
      "alex",
      "Alex",
      "password12345",
    );
    const cookie = s.session(guest.id);
    s.removeMember(room.id, guest.id);
    expect(s.authenticate(cookie).id).toBe(guest.id);
    expect(() => s.membership(room.id, guest.id)).toThrow();
  });
  it("deduplicates a retried human send and agent delivery", () => {
    const { s, room, owner } = fixture();
    const a = s.addAgent(room.id, {
      handle: "codex",
      name: "Codex",
      provider: "codex",
      model: "",
      instructions: "",
    });
    const first = s.requestMessage(owner, room.id, "hello", "same");
    const second = s.requestMessage(owner, room.id, "hello", "same");
    s.enqueue(a.id, first.message);
    s.enqueue(a.id, second.message);
    expect(second.duplicate).toBe(true);
    expect(s.messages(room.id)).toHaveLength(1);
    expect(s.work()).toHaveLength(1);
  });
  it("updates one streamed message without losing attribution or adding duplicate rows", () => {
    const { s, room, owner } = fixture();
    const { message } = s.requestMessage(owner, room.id, "hello", "one");
    s.putMessage(
      {
        ...message,
        id: "stream-first",
        text: "first",
        kind: "agent",
        status: "streaming",
      },
      "stream",
    );
    s.putMessage(
      {
        ...message,
        id: "other",
        text: "first second",
        kind: "agent",
        status: "complete",
      },
      "stream",
    );
    expect(s.messages(room.id)).toHaveLength(2);
    expect(s.messages(room.id)[1].text).toBe("first second");
  });
});
