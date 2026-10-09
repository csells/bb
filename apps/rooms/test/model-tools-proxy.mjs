import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const target = new URL(process.env.ROOMS_PROXY_TARGET);
const port = Number(process.env.ROOMS_PROXY_PORT ?? "38908");
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) {
      outgoing.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  if (incoming.method === "POST") {
    try {
      const payload = JSON.parse(body.toString());
      const names = Array.isArray(payload.tools)
        ? payload.tools.map((tool) =>
            String(tool.function?.name ?? tool.name ?? "unknown").slice(0, 100),
          )
        : [];
      const choice =
        typeof payload.tool_choice === "string"
          ? payload.tool_choice
          : (payload.tool_choice?.function?.name ?? null);
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          model: String(payload.model ?? "").slice(0, 100),
          toolNames: names,
          toolChoice: choice,
          stream: payload.stream === true,
        }),
      );
    } catch {
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          metadata: "non-json body",
        }),
      );
    }
  }
  const url = new URL(incoming.url, target);
  const forward = (url.protocol === "https:" ? httpsRequest : httpRequest)(
    url,
    {
      method: incoming.method,
      headers: {
        ...incoming.headers,
        host: url.host,
        "content-length": String(body.length),
      },
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  forward.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.on("aborted", () => forward.destroy());
  forward.end(body);
});
server.listen(port, "127.0.0.1", () =>
  console.log(JSON.stringify({ listening: port })),
);
process.on("SIGTERM", () => server.close());
