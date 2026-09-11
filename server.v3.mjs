import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AuditLog } from "./lib/audit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CK_V3_PORT || 3001);
const registry = JSON.parse(fs.readFileSync(path.join(here, "data/capability_registry.json"), "utf8"));
const audit = new AuditLog(path.join(here, "data/security_audit.jsonl"));
const sessions = new Map();

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  return m ? m[1].trim() : null;
}
function principalHash(token) {
  return token ? crypto.createHash("sha256").update(token).digest("hex") : null;
}

const buckets = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";
  let b = buckets.get(key);
  if (!b || now >= b.reset) b = { count: 0, reset: now + 60000 };
  b.count++;
  buckets.set(key, b);
  if (b.count > Number(process.env.CK_HTTP_RPM || 120))
    return res.status(429).json({ error: "rate_limited" });
  next();
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(rateLimit);
app.use(express.json({ limit: process.env.CK_MAX_BODY || "512kb", strict: true }));

app.get("/", (_req, res) => res.json({
  name: "CrossingKey Intelligence MCP",
  version: "3.0.0-canary",
  status: "hardened-canary",
  execution_default: registry.default_policy
}));

app.get("/health", (_req, res) => res.json({
  ok: true,
  service: "crossingkey-hardened-capability-server",
  version: "3.0.0-canary",
  divisions: registry.divisions.length,
  capabilities: registry.capabilities.length,
  enabled_capabilities: registry.capabilities.filter(c => c.enabled).length,
  execution_default: registry.default_policy
}));

function createServer() {
  const server = new Server(
    { name: "crossingkey-revenue", version: "3.0.0-canary" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_divisions",
        description: "List CrossingKey's 15 commercial divisions.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
      },
      {
        name: "list_capabilities",
        description: "List registered capabilities. Disabled means not executable.",
        inputSchema: {
          type: "object",
          properties: { division_id: { type: "string", pattern: "^(0[1-9]|1[0-5])$" } },
          additionalProperties: false
        }
      },
      {
        name: "describe_capability",
        description: "Return price, risk, limits and activation state.",
        inputSchema: {
          type: "object",
          required: ["capability_id"],
          properties: { capability_id: { type: "string", minLength: 3, maxLength: 100 } },
          additionalProperties: false
        }
      },
      {
        name: "execute_capability",
        description: "Metered execution gate. Currently deny-by-default until adapters pass security review.",
        inputSchema: {
          type: "object",
          required: ["capability_id", "request_id", "input"],
          properties: {
            capability_id: { type: "string", minLength: 3, maxLength: 100 },
            request_id: { type: "string", pattern: "^[A-Za-z0-9_-]{8,120}$" },
            input: { type: "object", maxProperties: 32 }
          },
          additionalProperties: false
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments || {};

    if (name === "list_divisions") {
      return {
        content: [{ type: "text", text: `${registry.divisions.length} divisions registered.` }],
        structuredContent: { divisions: registry.divisions }
      };
    }

    if (name === "list_capabilities") {
      const caps = registry.capabilities.filter(c => !args.division_id || c.division_id === args.division_id);
      return {
        content: [{ type: "text", text: `${caps.length} capabilities registered.` }],
        structuredContent: { capabilities: caps }
      };
    }

    if (name === "describe_capability") {
      const cap = registry.capabilities.find(c => c.id === args.capability_id);
      if (!cap) throw new Error("capability_not_found");
      return {
        content: [{ type: "text", text: `${cap.id}: ${cap.credits} credits; enabled=${cap.enabled}.` }],
        structuredContent: cap
      };
    }

    if (name === "execute_capability") {
      const cap = registry.capabilities.find(c => c.id === args.capability_id);
      if (!cap) throw new Error("capability_not_found");
      const token = bearer(globalThis.__ckCurrentReq || { headers: {} });
      audit.append({
        type: "capability.attempt",
        capability_id: cap.id,
        request_id: args.request_id,
        principal_hash: principalHash(token),
        enabled: cap.enabled
      });
      if (!token) throw new Error("authentication_required");
      if (!cap.enabled) throw new Error("capability_disabled");
      throw new Error("adapter_not_activated");
    }

    throw new Error("unknown_tool");
  });

  return server;
}

app.post("/mcp", async (req, res) => {
  globalThis.__ckCurrentReq = req;
  try {
    const sid = req.headers["mcp-session-id"];
    let entry = sid ? sessions.get(String(sid)) : null;

    if (!entry) {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: id => sessions.set(id, { server, transport })
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      entry = { server, transport };
    }

    await entry.transport.handleRequest(req, res, req.body);
  } catch (e) {
    audit.append({ type: "mcp.error", error: String(e?.message || e).slice(0, 500) });
    if (!res.headersSent)
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: req.body?.id ?? null });
  } finally {
    globalThis.__ckCurrentReq = null;
  }
});

app.get("/mcp", (_req, res) => res.status(405).json({ error: "use_POST_streamable_http" }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`CrossingKey MCP v3 hardened canary listening on 127.0.0.1:${PORT}`);
});
