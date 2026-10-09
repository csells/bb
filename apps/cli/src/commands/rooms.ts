import { z } from "zod";
import type { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createExperimentalRoomsClient } from "@bb/sdk";
import { action } from "../action.js";
const printJson = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};
export function registerRoomsCommands(program: Command) {
  const rooms = program
    .command("rooms")
    .description("Work with authenticated shared human-and-agent rooms")
    .requiredOption("--server <url>", "Rooms gateway URL")
    .requiredOption(
      "--token-file <path>",
      "Private file containing your Rooms session token",
    );
  rooms
    .command("login")
    .description("Save a seven-day session token without printing it")
    .requiredOption(
      "--credentials-file <path>",
      "Private JSON file with handle and password",
    )
    .action(
      action(async (opts: { credentialsFile: string }) => {
        const config = rooms.opts<{ server: string; tokenFile: string }>();
        const client = createExperimentalRoomsClient({
          baseUrl: config.server,
        });
        const value = await client.request(
          "POST",
          "/auth/token",
          JSON.parse(await readFile(opts.credentialsFile, "utf8")),
        );
        const token = z.object({ token: z.string() }).parse(value).token;
        await writeFile(config.tokenFile, token, { mode: 0o600, flag: "wx" });
        printJson({ saved: true });
      }),
    );
  async function client() {
    const opts = rooms.opts<{ server: string; tokenFile: string }>();
    return createExperimentalRoomsClient({
      baseUrl: opts.server,
      token: (await readFile(opts.tokenFile, "utf8")).trim(),
    });
  }
  rooms
    .command("list")
    .description("List your rooms")
    .option("--json", "JSON output")
    .action(action(async () => printJson((await (await client()).me()).rooms)));
  rooms
    .command("show <room>")
    .description("Read room membership, agents and conversation")
    .option("--json", "JSON output")
    .action(
      action(async (room: string) =>
        printJson(await (await client()).room(room)),
      ),
    );
  rooms
    .command("create <name>")
    .description("Create a room")
    .option("--json", "JSON output")
    .action(
      action(async (name: string) =>
        printJson(await (await client()).create(name)),
      ),
    );
  rooms
    .command("send <room>")
    .description("Send a prompt; @mentions choose agents")
    .requiredOption("--message-file <path>", "UTF-8 prompt file")
    .option("--json", "JSON output")
    .action(
      action(async (room: string, opts: { messageFile: string }) =>
        printJson(
          await (
            await client()
          ).send(room, {
            text: await readFile(opts.messageFile, "utf8"),
            requestId: randomUUID(),
            recipients: [],
          }),
        ),
      ),
    );
  rooms
    .command("invite <room>")
    .description("Create a one-use human invitation")
    .option("--json", "JSON output")
    .action(
      action(async (room: string) =>
        printJson(await (await client()).invite(room)),
      ),
    );
  rooms
    .command("agent-add <room>")
    .description("Add a persistent agent using a JSON configuration file")
    .requiredOption(
      "--file <path>",
      "JSON with handle, name, provider, model and instructions",
    )
    .option("--json", "JSON output")
    .action(
      action(async (room: string, opts: { file: string }) =>
        printJson(
          await (
            await client()
          ).addAgent(room, JSON.parse(await readFile(opts.file, "utf8"))),
        ),
      ),
    );
  rooms
    .command("stop <room> <agent>")
    .description("Stop one agent and its queued room work")
    .option("--json", "JSON output")
    .action(
      action(async (room: string, agent: string) =>
        printJson(await (await client()).stop(room, agent)),
      ),
    );
  rooms
    .command("steer <room> <agent>")
    .description("Redirect a running agent")
    .requiredOption("--message-file <path>", "UTF-8 steering message")
    .option("--json", "JSON output")
    .action(
      action(
        async (room: string, agent: string, opts: { messageFile: string }) =>
          printJson(
            await (
              await client()
            ).steer(room, agent, await readFile(opts.messageFile, "utf8")),
          ),
      ),
    );
  rooms
    .command("request <method> <path>")
    .description(
      "Call the Rooms API, including membership, default-agent and interaction operations",
    )
    .option("--body-file <path>", "JSON request body")
    .option("--json", "JSON output")
    .action(
      action(
        async (method: string, path: string, opts: { bodyFile?: string }) =>
          printJson(
            await (
              await client()
            ).request(
              method.toUpperCase(),
              path,
              opts.bodyFile
                ? JSON.parse(await readFile(opts.bodyFile, "utf8"))
                : undefined,
            ),
          ),
      ),
    );
}
