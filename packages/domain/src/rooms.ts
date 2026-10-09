import { z } from "zod";
export const roomsHandle = z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/);
export const roomsUserSchema = z.object({
  id: z.string(),
  handle: roomsHandle,
  name: z.string(),
});
export const roomsRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  defaultAgentId: z.string().nullable(),
  revision: z.number(),
});
export const roomsAgentSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  handle: roomsHandle,
  name: z.string(),
  provider: z.enum(["codex", "claude-code", "pi"]),
  model: z.string(),
  instructions: z.string(),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  lastSeq: z.number(),
  status: z.string(),
});
export const roomsMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  kind: z.enum(["human", "agent", "tool", "system"]),
  text: z.string(),
  status: z.enum(["complete", "streaming", "error", "stopped"]),
  createdAt: z.number(),
  causeId: z.string().nullable(),
  depth: z.number(),
});
export const roomsDeliverySchema = z.object({
  id: z.string(),
  roomId: z.string(),
  agentId: z.string(),
  messageId: z.string(),
  state: z.enum([
    "queued",
    "dispatching",
    "running",
    "complete",
    "error",
    "stopped",
  ]),
  error: z.string().nullable(),
  startedAt: z.number().nullable(),
  baseline: z.number(),
});
export type RoomsUser = z.infer<typeof roomsUserSchema>;
export type RoomsRoom = z.infer<typeof roomsRoomSchema>;
export type RoomsAgent = z.infer<typeof roomsAgentSchema>;
export type RoomsMessage = z.infer<typeof roomsMessageSchema>;
export type RoomsDelivery = z.infer<typeof roomsDeliverySchema>;
export const roomsSnapshotSchema = z.object({
  room: roomsRoomSchema,
  members: z.array(
    roomsUserSchema.extend({ role: z.enum(["owner", "member"]) }),
  ),
  agents: z.array(roomsAgentSchema),
  messages: z.array(roomsMessageSchema),
  deliveries: z.array(roomsDeliverySchema),
  online: z.array(z.string()),
});
export type RoomsSnapshot = z.infer<typeof roomsSnapshotSchema>;
export const roomsCreateAgentSchema = z
  .object({
    handle: roomsHandle,
    name: z.string().trim().min(1).max(80),
    provider: z.enum(["codex", "claude-code", "pi"]),
    model: z.string().max(100).default(""),
    instructions: z.string().max(4000).default(""),
  })
  .strict();
export const roomsMessageInputSchema = z
  .object({
    text: z.string().trim().min(1).max(16000),
    requestId: z.string().uuid(),
    recipients: z.array(z.string()).max(8).default([]),
  })
  .strict();
