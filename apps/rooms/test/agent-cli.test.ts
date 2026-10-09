import { afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeAgentCommand } from "../src/agent-cli.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("publishes a file through the activation credential and preserves the command receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rooms-cli-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const requests: { authorization: string | undefined; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    requests.push({
      authorization: request.headers.authorization,
      body: JSON.parse(body),
    });
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ messageId: "public-17", acceptedRecipients: [] }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No HTTP address");
  const activation = join(directory, "activation.json");
  const payload = join(directory, "payload.json");
  await writeFile(
    activation,
    JSON.stringify({
      endpoint: `http://127.0.0.1:${address.port}`,
      token: "private-activation-credential",
      activationId: "activation-one",
    }),
    { mode: 0o600 },
  );
  await writeFile(
    payload,
    JSON.stringify({
      text: "A model's deliberately public contribution",
      recipients: [],
    }),
  );
  const receipt = await executeAgentCommand([
    "--activation",
    activation,
    "--request-id",
    "bccf5a3b-0a08-41ae-a13d-8274770bfcf2",
    "post",
    "--json-file",
    payload,
  ]);
  expect(receipt).toEqual({ messageId: "public-17", acceptedRecipients: [] });
  expect(requests).toEqual([
    {
      authorization: "Bearer private-activation-credential",
      body: {
        operation: "post",
        requestId: "bccf5a3b-0a08-41ae-a13d-8274770bfcf2",
        args: {
          text: "A model's deliberately public contribution",
          recipients: [],
          intent: "post",
          replyTo: null,
        },
      },
    },
  ]);
});
