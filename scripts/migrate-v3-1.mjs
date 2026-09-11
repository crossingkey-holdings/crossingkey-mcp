#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2] || path.join(process.env.HOME, "Downloads", "crossingkey_developer_revenue_app");
const inventoryFile = path.join(target, "data", "capability_inventory.json");
const policyFile = path.join(target, "data", "promotion_policy.json");

function load(f){ return JSON.parse(fs.readFileSync(f,"utf8")); }
function writeAtomic(f,v){
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v,null,2), {mode:0o600});
  fs.renameSync(tmp,f);
}
function backup(f){
  const stamp = new Date().toISOString().replace(/[:.]/g,"-");
  const out = `${f}.pre-v3-1-${stamp}`;
  fs.copyFileSync(f,out);
  return out;
}

if (!fs.existsSync(inventoryFile) || !fs.existsSync(policyFile)) {
  console.error("ERROR: promotion machinery not installed in target:", target);
  process.exit(1);
}

console.log("Backups:");
console.log(" ", backup(inventoryFile));
console.log(" ", backup(policyFile));

const inv = load(inventoryFile);
const policy = load(policyFile);

let rust = inv.assets.find(a => a.asset_id === "xkey.rust.operator-control-plane");
if (rust) {
  rust.asset_id = "agenticos.operator-control-plane";
  rust.display_name = "CrossingKey Agentic OS Rust Operator Control Plane";
  rust.provider = "agenticos";
  rust.blocked_capabilities = [
    "agenticos.operator.execute",
    "agenticos.operator.route",
    "agenticos.operator.release"
  ];
  rust.reason = "Verified interactive Agentic OS operator control plane. Remains operator-facing and is not the .xkey language/compiler surface.";
}

if (!inv.assets.some(a => a.asset_id === "xkey.language-tooling")) {
  inv.assets.push({
    asset_id: "xkey.language-tooling",
    display_name: ".xkey Machine-Readable Language Tooling",
    provider: "xkey",
    status: "DISCOVERED_UNVERIFIED",
    eligible_for_public_execution: false,
    reason: "Represents the .xkey language/parser/compiler/tooling surface. Exact machine-facing implementation must be verified before promotion.",
    evidence: [],
    blocked_capabilities: [
      "xkey.validate",
      "xkey.inspect",
      "xkey.compile",
      "xkey.package"
    ]
  });
}

inv.policy ||= {};
inv.policy.series_ip_excluded_from_commercial_systems = true;
inv.policy.series_ip_scan_required_before_canary = true;
inv.policy.series_ip_manual_attestation_required_before_production = true;
inv.policy.brand_name_does_not_imply_series_content = true;

policy.gates ||= {};
policy.gates.SECURITY_REVIEWED ||= {requires:[],checks:[]};
if (!policy.gates.SECURITY_REVIEWED.requires.includes("series_ip_scan_report"))
  policy.gates.SECURITY_REVIEWED.requires.push("series_ip_scan_report");
if (!policy.gates.SECURITY_REVIEWED.checks.includes("series_ip_scan_pass"))
  policy.gates.SECURITY_REVIEWED.checks.push("series_ip_scan_pass");

policy.gates.PRODUCTION_ENABLED ||= {requires:[],checks:[]};
if (!policy.gates.PRODUCTION_ENABLED.requires.includes("series_ip_exclusion_attestation"))
  policy.gates.PRODUCTION_ENABLED.requires.push("series_ip_exclusion_attestation");

policy.series_ip_boundary = {
  rule: "Commercial MCP capabilities, CCMB services, Agentic OS services, .xkey tooling, AAPCL, catalogs, docs, examples, receipts, prompts, outputs, training material, and storefront metadata must be series-neutral.",
  default: "deny_on_match_or_uncertainty",
  brand_usage: "CrossingKey technical/company branding is allowed; private fictional-series content is not.",
  scanner_config: "data/series_exclusion_patterns.json"
};

writeAtomic(inventoryFile, inv);
writeAtomic(policyFile, policy);

console.log("PASS taxonomy + series-IP boundary migrated");
for (const a of inv.assets) console.log(`${a.asset_id}: ${a.status}`);
