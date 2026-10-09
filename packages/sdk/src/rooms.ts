import { z } from "zod";
import {
  roomsAgentSchema,
  roomsRoomSchema,
  roomsSnapshotSchema,
  roomsUserSchema,
  roomsCreateAgentSchema,
  roomsMessageInputSchema,
  roomsPolicyInputSchema,
  roomsAgentCommandSchema,
  roomsAgentCommandResultSchema,
  roomsActivitySchema,
  roomsPublicationReceiptSchema,
} from "@bb/domain";
export interface ExperimentalRoomsClientOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}
export function createExperimentalRoomsClient(
  options: ExperimentalRoomsClientOptions,
) {
  const fetcher = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  async function request(method: string, path: string, body?: unknown) {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
      throw new Error("Rooms path must be an absolute API-relative path");
    const response = await fetcher(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Rooms-Request": "1",
        ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(result);
      throw new Error(
        error.success
          ? error.data.error
          : `Rooms request failed (${response.status})`,
      );
    }
    return result;
  }
  return {
    request,
    async me() {
      return z
        .object({ user: roomsUserSchema, rooms: z.array(roomsRoomSchema) })
        .parse(await request("GET", "/me"));
    },
    async room(roomId: string) {
      return roomsSnapshotSchema.parse(
        await request("GET", `/rooms/${encodeURIComponent(roomId)}`),
      );
    },
    async create(name: string) {
      return roomsRoomSchema.parse(await request("POST", "/rooms", { name }));
    },
    async invite(roomId: string) {
      return z
        .object({ invite: z.string() })
        .parse(
          await request(
            "POST",
            `/rooms/${encodeURIComponent(roomId)}/invites`,
            {},
          ),
        );
    },
    async join(invite: string) {
      return roomsRoomSchema.parse(await request("POST", "/join", { invite }));
    },
    async addAgent(
      roomId: string,
      input: z.input<typeof roomsCreateAgentSchema>,
    ) {
      return roomsAgentSchema.parse(
        await request(
          "POST",
          `/rooms/${encodeURIComponent(roomId)}/agents`,
          roomsCreateAgentSchema.parse(input),
        ),
      );
    },
    async send(roomId: string, input: z.input<typeof roomsMessageInputSchema>) {
      return roomsPublicationReceiptSchema.parse(
        await request(
          "POST",
          `/rooms/${encodeURIComponent(roomId)}/messages`,
          roomsMessageInputSchema.parse(input),
        ),
      );
    },
    async policy(
      roomId: string,
      input: z.input<typeof roomsPolicyInputSchema>,
    ) {
      return roomsRoomSchema.parse(
        await request(
          "PUT",
          `/rooms/${encodeURIComponent(roomId)}/policy`,
          roomsPolicyInputSchema.parse(input),
        ),
      );
    },
    async agentCommand(input: z.input<typeof roomsAgentCommandSchema>) {
      return roomsAgentCommandResultSchema.parse(
        await request(
          "POST",
          "/agent/commands",
          roomsAgentCommandSchema.parse(input),
        ),
      );
    },
    async stop(roomId: string, agentId: string) {
      return z
        .object({ ok: z.literal(true) })
        .parse(
          await request(
            "POST",
            `/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}/stop`,
            {},
          ),
        );
    },
    async activity(roomId: string, agentId: string) {
      return roomsActivitySchema.parse(
        await request(
          "GET",
          `/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}/activity`,
        ),
      );
    },
    async recover(roomId: string, agentId: string) {
      return z
        .object({
          recovered: z.literal(true),
          inspectedThreads: z.array(z.string()),
        })
        .parse(
          await request(
            "POST",
            `/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}/recover`,
            {},
          ),
        );
    },
    async steer(roomId: string, agentId: string, text: string) {
      return z
        .object({
          accepted: z.literal(true),
          delivery: z.enum(["sent", "queued"]),
        })
        .parse(
          await request(
            "POST",
            `/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}/steer`,
            { text },
          ),
        );
    },
  };
}
