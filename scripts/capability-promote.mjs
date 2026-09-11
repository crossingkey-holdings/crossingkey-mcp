#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PromotionEngine } from "../lib/promotion.mjs";
import { AuditLog } from "../lib/audit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const audit = new AuditLog(path.join(root, "data", "security_audit.jsonl"));
const engine = new PromotionEngine({
  inventoryFile: path.join(root, "data", "capability_inventory.json"),
  policyFile: path.join(root, "data", "promotion_policy.json"),
  audit
});

const [cmd, ...args] = process.argv.slice(2);

function out(v) { console.log(JSON.stringify(v, null, 2)); }
function fail(msg) { console.error(msg); process.exit(1); }

if (cmd === "list") {
  out(engine.list(args[0] || null));
} else if (cmd === "show") {
  if (!args[0]) fail("usage: capability-promote.mjs show <asset_id>");
  out(engine.explain(args[0]));
} else if (cmd === "promote") {
  const [assetId, targetStatus, evidenceFile] = args;
  if (!assetId || !targetStatus || !evidenceFile) {
    fail("usage: capability-promote.mjs promote <asset_id> <target_status> <evidence.json> [--approve-production]");
  }
  const evidence = JSON.parse((await import("node:fs")).readFileSync(evidenceFile, "utf8"));
  out(engine.promote({
    assetId,
    targetStatus,
    evidence,
    operatorApproval: args.includes("--approve-production")
  }));
} else if (cmd === "suspend") {
  const [assetId, ...reasonParts] = args;
  if (!assetId) fail("usage: capability-promote.mjs suspend <asset_id> <reason>");
  out(engine.suspend({assetId, reason: reasonParts.join(" ")}));
} else {
  console.log(`CrossingKey Capability Promotion CLI

Commands:
  list [STATUS]
  show <asset_id>
  promote <asset_id> <TARGET_STATUS> <evidence.json> [--approve-production]
  suspend <asset_id> <reason>
`);
}
