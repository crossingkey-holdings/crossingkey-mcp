import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ORDER = [
  "DISCOVERED_UNVERIFIED",
  "SOURCE_VERIFIED",
  "RUNTIME_VERIFIED",
  "SECURITY_REVIEWED",
  "METERING_VERIFIED",
  "CANARY_ENABLED",
  "PRODUCTION_ENABLED"
];

function load(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function atomicWrite(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function sha256(v) {
  return crypto.createHash("sha256").update(String(v)).digest("hex");
}
function now() {
  return new Date().toISOString();
}

export class PromotionEngine {
  constructor({inventoryFile, policyFile, audit}) {
    this.inventoryFile = inventoryFile;
    this.policyFile = policyFile;
    this.audit = audit;
  }

  inventory() {
    return load(this.inventoryFile);
  }

  policy() {
    return load(this.policyFile);
  }

  get(assetId) {
    return this.inventory().assets.find(a => a.asset_id === assetId) || null;
  }

  list(status = null) {
    const assets = this.inventory().assets;
    return status ? assets.filter(a => a.status === status) : assets;
  }

  explain(assetId) {
    const asset = this.get(assetId);
    if (!asset) throw new Error("asset_not_found");

    const current = ORDER.indexOf(asset.status);
    const next = current >= 0 && current < ORDER.length - 1 ? ORDER[current + 1] : null;
    const policy = this.policy();

    return {
      asset_id: asset.asset_id,
      status: asset.status,
      next_status: next,
      eligible_for_public_execution: Boolean(asset.eligible_for_public_execution),
      next_gate: next ? policy.gates[next] || null : null,
      reason: asset.reason || null
    };
  }

  promote({assetId, targetStatus, evidence, operatorApproval = false}) {
    const inv = this.inventory();
    const policy = this.policy();
    const asset = inv.assets.find(a => a.asset_id === assetId);
    if (!asset) throw new Error("asset_not_found");
    if (!ORDER.includes(targetStatus)) throw new Error("invalid_target_status");

    const currentIdx = ORDER.indexOf(asset.status);
    const targetIdx = ORDER.indexOf(targetStatus);
    if (targetIdx !== currentIdx + 1) throw new Error("promotion_must_be_single_step");

    const gate = policy.gates[targetStatus];
    if (!gate) throw new Error("promotion_gate_missing");
    if (!Array.isArray(evidence) || !evidence.length) throw new Error("evidence_required");

    if (targetStatus === "PRODUCTION_ENABLED" && operatorApproval !== true) {
      throw new Error("operator_approval_required");
    }

    const receipt = {
      receipt_id: `prom_${crypto.randomBytes(12).toString("base64url")}`,
      asset_id: assetId,
      from_status: asset.status,
      to_status: targetStatus,
      evidence_hash: sha256(JSON.stringify(evidence)),
      evidence,
      operator_approval: operatorApproval === true,
      created_at: now()
    };

    asset.status = targetStatus;
    asset.last_promotion_receipt = receipt;
    if (targetStatus === "CANARY_ENABLED" || targetStatus === "PRODUCTION_ENABLED") {
      asset.eligible_for_public_execution = true;
    }

    inv.receipts ||= [];
    inv.receipts.push(receipt);
    atomicWrite(this.inventoryFile, inv);

    this.audit?.append({
      type: "capability.promotion",
      receipt_id: receipt.receipt_id,
      asset_id: assetId,
      from_status: receipt.from_status,
      to_status: targetStatus,
      evidence_hash: receipt.evidence_hash
    });

    return receipt;
  }

  suspend({assetId, reason}) {
    const inv = this.inventory();
    const asset = inv.assets.find(a => a.asset_id === assetId);
    if (!asset) throw new Error("asset_not_found");
    const previous = asset.status;
    asset.status = "SUSPENDED";
    asset.eligible_for_public_execution = false;
    const receipt = {
      receipt_id: `susp_${crypto.randomBytes(12).toString("base64url")}`,
      asset_id: assetId,
      from_status: previous,
      to_status: "SUSPENDED",
      reason: String(reason || "unspecified").slice(0, 500),
      created_at: now()
    };
    inv.receipts ||= [];
    inv.receipts.push(receipt);
    atomicWrite(this.inventoryFile, inv);
    this.audit?.append({type:"capability.suspend", ...receipt});
    return receipt;
  }
}
