import { z } from "zod";
export const roomsHandle = z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/);
export const roomsIntentSchema = z.enum(["post", "request", "notice"]);
export const roomsUserSchema = z.object({
  id: z.string(),
  handle: roomsHandle,
  name: z.string(),
});
export const roomsRoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  revision: z.number(),
  paused: z.boolean(),
  pauseReason: z.string().nullable(),
  maxActivations: z.number().int().positive().nullable(),
  activationsUsed: z.number().int().nonnegative(),
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
  status: z.string(),
});
export const roomsMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  kind: z.enum(["human", "agent", "system"]),
  text: z.string(),
  status: z.enum(["complete", "streaming", "error", "stopped"]),
  createdAt: z.number(),
  causeId: z.string().nullable(),
  intent: roomsIntentSchema,
  recipients: z.array(z.string()),
  replyTo: z.string().nullable(),
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
    "uncertain",
  ]),
  error: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  intent: roomsIntentSchema,
  activationId: z.string().nullable(),
  threadId: z.string().nullable(),
  outcome: z.enum(["replied", "no_reply"]).nullable(),
});
export const roomsActivationSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  roomId: z.string(),
  deliveryId: z.string(),
  state: z.enum(["dispatching", "running", "settled", "stopped", "uncertain"]),
  threadId: z.string().nullable(),
  epoch: z.number().int(),
  revoked: z.boolean(),
  stopRequested: z.boolean(),
});
export type RoomsUser = z.infer<typeof roomsUserSchema>;
export type RoomsRoom = z.infer<typeof roomsRoomSchema>;
export type RoomsAgent = z.infer<typeof roomsAgentSchema>;
export type RoomsMessage = z.infer<typeof roomsMessageSchema>;
export type RoomsDelivery = z.infer<typeof roomsDeliverySchema>;
export type RoomsActivation = z.infer<typeof roomsActivationSchema>;
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
export const roomsPublicationSchema = z
  .object({
    text: z.string().trim().min(1).max(16000),
    intent: roomsIntentSchema.default("post"),
    recipients: z.array(z.string().min(1)).max(100).default([]),
    replyTo: z.string().nullable().default(null),
  })
  .strict();
export const roomsMessageInputSchema = roomsPublicationSchema
  .extend({ requestId: z.string().uuid() })
  .strict();
export const roomsPolicyInputSchema = z
  .object({
    paused: z.boolean(),
    maxActivations: z.number().int().positive().max(100000).nullable(),
  })
  .strict();
const requestId = z.string().min(1).max(128);
const streamRef = z.string().min(1);
export const roomsAgentCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("read"),
      requestId,
      args: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("post"),
      requestId,
      args: roomsPublicationSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("request"),
      requestId,
      args: roomsPublicationSchema.omit({ intent: true }),
    })
    .strict(),
  z
    .object({
      operation: z.literal("stream.begin"),
      requestId,
      args: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("stream.append"),
      requestId,
      args: z
        .object({
          messageId: streamRef,
          sequence: z.number().int().nonnegative(),
          text: z.string().min(1).max(16000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("stream.commit"),
      requestId,
      args: roomsPublicationSchema
        .omit({ text: true })
        .extend({ messageId: streamRef })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("stream.abort"),
      requestId,
      args: z.object({ messageId: streamRef }).strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("settle"),
      requestId,
      args: z.object({ outcome: z.enum(["replied", "no_reply"]) }).strict(),
    })
    .strict(),
]);
export type RoomsAgentCommand = z.infer<typeof roomsAgentCommandSchema>;
export type RoomsPublication = z.infer<typeof roomsPublicationSchema>;
export const roomsPublicationReceiptSchema = z
  .object({ message: roomsMessageSchema, duplicate: z.boolean() })
  .strict();

export const roomsAgentCommandResultSchema = z.union([
  z
    .object({
      activation: roomsActivationSchema,
      snapshot: roomsSnapshotSchema,
      inbox: z.array(roomsDeliverySchema),
    })
    .strict(),
  roomsPublicationReceiptSchema,
  z
    .object({ messageId: z.string(), sequence: z.number().int().nonnegative() })
    .strict(),
  z.object({ messageId: z.string() }).strict(),
  z.object({ outcome: z.enum(["replied", "no_reply"]) }).strict(),
]);
export type RoomsAgentCommandResult = z.infer<
  typeof roomsAgentCommandResultSchema
>;
export const roomsActivitySchema = z.object({
  providerStatus: z.string().nullable(),
  threadId: z.string().nullable(),
  activationId: z.string().nullable(),
  deliveryId: z.string().nullable(),
  startedAt: z.number().nullable(),
});
