// Cloudflare Worker relay for AI APIs that refuse direct browser calls (CORS).
// Request:  https://<your-worker>.workers.dev/https://api.deepseek.com/chat/completions
// The worker forwards it to the URL after the first "/" and adds CORS headers.
// Your API key passes through in the request headers; the worker stores nothing.
//
// Optional: set the variable ALLOW_ORIGIN (e.g. https://yourname.github.io) in the
// Worker settings so only your page can use this relay.

const ALLOWED_HOSTS = new Set([
  "api.anthropic.com",
  "api.deepseek.com",
  "dashscope.aliyuncs.com",
  "dashscope-intl.aliyuncs.com",
  "api.moonshot.cn",
  "api.moonshot.ai",
  "open.bigmodel.cn",
  "api.z.ai",
  "ark.cn-beijing.volces.com",
  "ark.ap-southeast.bytepluses.com",
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const allowOrigin = env.ALLOW_ORIGIN || "*";
    const cors = {
      "access-control-allow-origin": allowOrigin === "*" ? "*" : allowOrigin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": request.headers.get("access-control-request-headers") || "*",
      "access-control-max-age": "86400",
      "vary": "origin",
    };
    if (allowOrigin !== "*" && origin !== allowOrigin) {
      return new Response("Origin not allowed", { status: 403, headers: cors });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return new Response("Only POST is supported", { status: 405, headers: cors });

    const url = new URL(request.url);
    let target;
    try {
      target = new URL(url.pathname.slice(1).replace(/^(https?:)\/(?!\/)/, "$1//") + url.search);
    } catch {
      return new Response("Usage: /https://api.example.com/path", { status: 400, headers: cors });
    }
    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
      return new Response(`Host not allowed: ${target.hostname}`, { status: 403, headers: cors });
    }

    const headers = new Headers(request.headers);
    for (const h of ["origin", "referer", "host", "cf-connecting-ip", "x-forwarded-for", "x-real-ip"]) headers.delete(h);
    const upstream = await fetch(target, { method: "POST", headers, body: request.body });
    const response = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },
};
