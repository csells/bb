import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { roomsAgentCommandSchema } from "@bb/domain";

const credentialSchema = z
  .object({
    endpoint: z
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
    token: z.string().min(1),
    activationId: z.string().min(1),
  })
  .strict();
const operationSchema = z.enum([
  "read",
  "post",
  "request",
  "stream.begin",
  "stream.append",
  "stream.commit",
  "stream.abort",
  "settle",
]);
const objectSchema = z.record(z.string(), z.json());

export const agentCliHelp = `room --activation FILE COMMAND [OPTIONS]

read                         Read room participants, public messages and this delivery
post --text TEXT [--to HANDLE]
                             Publish your contribution without waking anyone
request --to HANDLE --text TEXT
                             Publish and queue a request; peer answers arrive in a later activation
stream begin                 Takes no message ID; creates and returns a new stream ID
stream append --message ID --sequence N --text TEXT
                             Append your next public chunk; sequences start at zero
stream commit --message ID [--to HANDLE] [--intent post|request|notice]
                             Finish the message and notify recipients once
stream abort --message ID    Mark your unfinished public message interrupted
settle --outcome no_reply|replied
                             Say you are done; ending the private turn also settles

--text-file FILE              Read long text from a UTF-8 file
--json-file FILE              Read the command's JSON arguments from a file (- for stdin)
--reply-to ID                 Reply to a public message
--request-id UUID             Reuse this ID when retrying a command after a lost receipt

Your activation credential fixes your identity and room. Never print its contents.
Only these publication commands speak to the room. Ordinary agent output stays private.
Do not request replies just to acknowledge another participant or say goodbye.
`;

export async function executeAgentCommand(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      activation: { type: "string" },
      "request-id": { type: "string" },
      "json-file": { type: "string" },
      "text-file": { type: "string" },
      text: { type: "string" },
      to: { type: "string", multiple: true },
      "reply-to": { type: "string" },
      message: { type: "string" },
      sequence: { type: "string" },
      intent: { type: "string" },
      outcome: { type: "string" },
    },
  });
  if (!values.activation) throw new Error("--activation FILE is required");
  const operation = operationSchema.parse(positionals.join("."));
  const credential = credentialSchema.parse(
    JSON.parse(await readFile(values.activation, "utf8")),
  );
  const requestId = z
    .string()
    .min(1)
    .max(128)
    .parse(values["request-id"] ?? crypto.randomUUID());
  const acceptedFlags: Record<z.infer<typeof operationSchema>, string[]> = {
    read: [],
    post: ["text", "text-file", "to", "reply-to", "intent"],
    request: ["text", "text-file", "to", "reply-to"],
    "stream.begin": [],
    "stream.append": ["text", "text-file", "message", "sequence"],
    "stream.commit": ["message", "to", "reply-to", "intent"],
    "stream.abort": ["message"],
    settle: ["outcome"],
  };
  for (const flag of Object.keys(values))
    if (
      ![
        "activation",
        "request-id",
        "json-file",
        ...acceptedFlags[operation],
      ].includes(flag)
    )
      throw new Error(`--${flag} is not accepted by ${operation}`);
  const endpoint = new URL("/api/agent/commands", credential.endpoint);
  const send = async (
    op: z.infer<typeof operationSchema>,
    args: z.infer<typeof objectSchema>,
    key: string,
  ) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
        "X-Rooms-Request": "1",
      },
      body: JSON.stringify(
        roomsAgentCommandSchema.parse({ operation: op, requestId: key, args }),
      ),
      signal: AbortSignal.timeout(30000),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(result);
      throw new Error(
        error.success
          ? error.data.error
          : `Room command failed (${response.status})`,
      );
    }
    return z.json().parse(result);
  };
  if (values["json-file"]) {
    if (
      [
        values.text,
        values["text-file"],
        values.to,
        values["reply-to"],
        values.message,
        values.sequence,
        values.intent,
        values.outcome,
      ].some((v) => v !== undefined)
    )
      throw new Error("Use either --json-file or command flags");
    let text: string;
    if (values["json-file"] === "-") {
      text = "";
      for await (const chunk of process.stdin) text += String(chunk);
    } else text = await readFile(values["json-file"], "utf8");
    return send(operation, objectSchema.parse(JSON.parse(text)), requestId);
  }
  if (values.text !== undefined && values["text-file"] !== undefined)
    throw new Error("Use either --text or --text-file");
  const text =
    values["text-file"] === undefined
      ? values.text
      : await readFile(values["text-file"], "utf8");
  const args: z.infer<typeof objectSchema> = {};
  if (["post", "request", "stream.append"].includes(operation))
    args.text = z.string().min(1).parse(text);
  if (["stream.append", "stream.commit", "stream.abort"].includes(operation))
    args.messageId = z.string().min(1).parse(values.message);
  if (operation === "stream.append")
    args.sequence = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(values.sequence);
  if (["post", "request", "stream.commit"].includes(operation)) {
    if (operation !== "request")
      args.intent = z
        .enum(["post", "request", "notice"])
        .parse(
          values.intent ??
            (operation === "stream.commit" && values.to?.length
              ? "request"
              : "post"),
        );
    args.replyTo = values["reply-to"] ?? null;
    args.recipients = [];
    if (values.to?.length) {
      const participant = z.object({ id: z.string(), handle: z.string() });
      const read = z
        .object({
          snapshot: z.object({
            agents: z.array(participant),
            members: z.array(participant),
          }),
        })
        .parse(await send("read", {}, crypto.randomUUID()));
      const participants = [...read.snapshot.agents, ...read.snapshot.members];
      args.recipients = [
        ...new Set(
          values.to.map((target) => {
            const handle = target.replace(/^@/, "").toLowerCase();
            const matches = participants.filter(
              (candidate) =>
                candidate.id === target || candidate.handle === handle,
            );
            if (matches.length !== 1)
              throw new Error(
                matches.length
                  ? `Ambiguous room participant ${target}`
                  : `No room participant matches ${target}`,
              );
            return matches[0].id;
          }),
        ),
      ];
    }
  }
  if (operation === "settle")
    args.outcome = z.enum(["replied", "no_reply"]).parse(values.outcome);
  return send(operation, args, requestId);
}

export async function runAgentCli(argv: string[]) {
  try {
    if (argv.some((arg) => ["--help", "-h"].includes(arg)))
      console.log(agentCliHelp);
    else console.log(JSON.stringify(await executeAgentCommand(argv)));
  } catch (error: unknown) {
    console.error(
      error instanceof Error ? error.message : "Room command failed",
    );
    if (
      error instanceof z.ZodError ||
      (error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code.startsWith("ERR_PARSE_ARGS"))
    )
      console.error(agentCliHelp);
    process.exitCode = 1;
  }
}
