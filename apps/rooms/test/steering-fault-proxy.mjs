import { createServer } from "node:http";
import { once } from "node:events";

export async function steeringFaultProxy(target, mode) {
  const intercepted = Promise.withResolvers();
  const acknowledgment = Promise.withResolvers();
  let held;
  let released;
  async function forward(request) {
    const response = await fetch(new URL(request.path, target), {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      ...(request.body.length ? { body: request.body } : {}),
    });
    return { status: response.status, body: await response.text() };
  }
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const submission = { path: request.url, method: request.method, body };
      const parsed = body.length ? JSON.parse(body.toString()) : null;
      if (!held && request.url.endsWith("/send") && parsed?.mode === "steer") {
        held = submission;
        intercepted.resolve(parsed);
        if (mode === "drop-after" || mode === "delay-after")
          released = forward(held);
        if (mode === "drop-after" || mode === "delay-after") await released;
        if (mode === "delay-after") {
          const result = await acknowledgment.promise;
          response.writeHead(result.status, {
            "Content-Type": "application/json",
          });
          response.end(result.body);
        } else if (mode !== "crash-before") response.destroy();
        return;
      }
      const result = await forward(submission);
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(result.body);
    } catch {
      response.destroy();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    intercepted: intercepted.promise,
    async release() {
      if (!held) throw new Error("No steering submission was intercepted");
      released ??= forward(held);
      const result = await released;
      acknowledgment.resolve(result);
      return { status: result.status };
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
