import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function redact(v) {
  let s = typeof v === "string" ? v : JSON.stringify(v ?? null);
  return s
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]+\b/g, "[REDACTED_STRIPE_KEY]")
    .replace(/\bwhsec_[A-Za-z0-9_]+\b/g, "[REDACTED_WEBHOOK_SECRET]")
    .replace(/\bck_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_CREDIT_TOKEN]")
    .slice(0, 200000);
}

export class AuditLog {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.lastHash = "GENESIS";
    try {
      const lines = fs.readFileSync(file, "utf8").trim().split("\n");
      if (lines[0]) this.lastHash = JSON.parse(lines.at(-1)).event_hash || "GENESIS";
    } catch {}
  }

  append(event) {
    const body = {
      timestamp: new Date().toISOString(),
      previous_hash: this.lastHash,
      ...event
    };
    const safe = JSON.parse(redact(body));
    const event_hash = crypto
      .createHash("sha256")
      .update(this.lastHash + "\n" + JSON.stringify(safe))
      .digest("hex");
    const record = { ...safe, event_hash };
    fs.appendFileSync(this.file, JSON.stringify(record) + "\n", { mode: 0o600 });
    this.lastHash = event_hash;
    return record;
  }
}
