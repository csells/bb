import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(new URL("../../../../../apps/rooms/package.json", import.meta.url));
const { WebSocket, WebSocketServer } = require("ws");
const output = process.env.ROOMS_IOS_OUTPUT;
if (!output) throw new Error("ROOMS_IOS_OUTPUT is required");
const token = (await readFile("/Users/admin/rooms-native-qa/operator-token", "utf8")).trim();
const auditScript = await readFile(new URL("audit.js", import.meta.url));
await mkdir(output, { recursive: true });
const observations = [];
const requests = [];
async function persist() {
  await writeFile(path.join(output, "browser-audit.json"), JSON.stringify({ observations, requests }, null, 2));
}
function headers(input) {
  return { ...input, host: "127.0.0.1:38910", authorization: `Bearer ${token}`, origin: "http://127.0.0.1:38910", "accept-encoding": "identity" };
}
const server = http.createServer(async (incoming, response) => {
  console.log(JSON.stringify({ phase: "request", path: incoming.url?.split("?")[0], mobile: incoming.headers["user-agent"]?.includes("Mobile") ?? false }));
  response.on("finish", () => console.log(JSON.stringify({ phase: "finished", path: incoming.url?.split("?")[0], status: response.statusCode })));
  if (incoming.url === "/__ios/audit.js") {
    response.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" });
    response.end(auditScript);
    return;
  }
  if (incoming.url === "/__ios/evidence") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ observations, requests }));
    return;
  }
  if (incoming.url === "/__ios/audit" && incoming.method === "POST") {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks).toString());
    observations.push(...value);
    await persist();
    response.writeHead(204).end();
    return;
  }
  const request = http.request({ hostname: "127.0.0.1", port: 38910, path: incoming.url, method: incoming.method, headers: headers(incoming.headers) }, (upstream) => {
    requests.push({ path: incoming.url?.split("?")[0], method: incoming.method, status: upstream.statusCode });
    if (upstream.headers["content-type"]?.includes("text/html")) {
      const chunks = [];
      upstream.on("data", (chunk) => chunks.push(chunk));
      upstream.on("end", () => {
        const result = Buffer.from(Buffer.concat(chunks).toString().replace("</head>", '<script src="/__ios/audit.js"></script></head>'));
        const outputHeaders = { ...upstream.headers, "content-length": String(result.length), "cache-control": "no-store" };
        delete outputHeaders["transfer-encoding"];
        response.writeHead(upstream.statusCode ?? 502, outputHeaders).end(result);
      });
    } else {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
    }
  });
  request.on("error", () => { response.writeHead(502).end("Candidate gateway unavailable"); });
  incoming.pipe(request);
});
const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const upstream = new WebSocket(`ws://127.0.0.1:38910${request.url}`, { headers: headers(request.headers) });
  upstream.on("error", () => socket.destroy());
  upstream.on("open", () => sockets.handleUpgrade(request, socket, head, (client) => {
    client.on("message", (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
    upstream.on("message", (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
    client.on("close", () => upstream.close());
    upstream.on("close", () => client.close());
  }));
});
server.listen(38920, "127.0.0.1", () => console.log("iOS QA proxy ready on loopback 38920"));
