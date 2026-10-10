import { z } from "zod";
import {
  roomsRoomSchema,
  roomsSnapshotSchema,
  roomsUserSchema,
} from "@bb/domain";

const sessionSchema = z.object({
  user: roomsUserSchema,
  rooms: z.array(roomsRoomSchema),
  access: z.object({ operator: z.boolean() }),
});
export type RoomsSession = z.infer<typeof sessionSchema>;

export class RoomsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function roomsRequest(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Rooms-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const problem = z.object({ error: z.string() }).safeParse(value);
    throw new RoomsRequestError(
      problem.success
        ? problem.data.error
        : `Request failed (${response.status})`,
      response.status,
    );
  }
  return value;
}

export async function loadRoomsSession() {
  return sessionSchema.parse(await roomsRequest("/me"));
}
export async function loadRoom(roomId: string) {
  return roomsSnapshotSchema.parse(
    await roomsRequest(`/rooms/${encodeURIComponent(roomId)}/poll`),
  );
}
export function roomPath(roomId: string) {
  return `/rooms/${encodeURIComponent(roomId)}`;
}
