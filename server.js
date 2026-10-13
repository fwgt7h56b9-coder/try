// Serves the web app and proxies Claude API calls so the API key stays on the server.
// Zero dependencies; requires Node 18+.
//
//   ANTHROPIC_API_KEY=sk-ant-... [APP_PASSWORD=secret] [PORT=3000] node server.js
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const PASSWORD = process.env.APP_PASSWORD || "";
const UPSTREAM = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const ALLOWED_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
const MAX_BODY = 5 * 1024 * 1024;

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

function passwordOk(req) {
  if (!PASSWORD) return true;
  const given = Buffer.from(String(req.headers["x-app-password"] || ""));
  const expected = Buffer.from(PASSWORD);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyMessages(req, res) {
  if (!passwordOk(req)) {
    return sendJson(res, 403, { type: "error", error: { type: "permission_error", message: "Wrong app password" } });
  }
  let body;
  try {
    body = await readBody(req);
    const { model } = JSON.parse(body.toString("utf8"));
    if (!ALLOWED_MODELS.has(model)) throw new Error(`model not allowed: ${model}`);
  } catch (err) {
    return sendJson(res, 400, { type: "error", error: { type: "invalid_request_error", message: err.message } });
  }

  const headers = {
    "content-type": "application/json",
    "x-api-key": API_KEY,
    "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
  };
  if (req.headers["anthropic-beta"]) headers["anthropic-beta"] = req.headers["anthropic-beta"];

  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    const upstream = await fetch(`${UPSTREAM}/v1/messages`, { method: "POST", headers, body, signal: controller.signal });
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-cache",
    });
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (err) {
    if (res.headersSent) return res.end();
    sendJson(res, 502, { type: "error", error: { type: "api_error", message: `Upstream error: ${err.message}` } });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path += "index.html";
  const file = join(PUBLIC_DIR, path);
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (req.method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, { passwordRequired: Boolean(PASSWORD) });
  }
  if (req.method === "POST" && pathname === "/api/v1/messages") return proxyMessages(req, res);
  if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  res.writeHead(405).end();
}).listen(PORT, () => {
  console.log(`同声传译 running at http://localhost:${PORT}${PASSWORD ? " (password protected)" : ""}`);
});
