import fs from "node:fs/promises";
import { validateSubmission } from "../lib/trybounty/validator.mjs";

const [jobFile, manifestFile] = process.argv.slice(2);

if (!jobFile || !manifestFile) {
  console.error(
    "Usage: node scripts/trybounty-review.mjs JOB_SPEC.json SUBMISSION_MANIFEST.json"
  );
  process.exit(2);
}

const job = JSON.parse(
  await fs.readFile(jobFile, "utf8")
);

const manifest = JSON.parse(
  await fs.readFile(manifestFile, "utf8")
);

const result = validateSubmission(job, manifest);

console.log("");
console.log("========================================");
console.log("CROSSINGKEY SUBMISSION REVIEW");
console.log("========================================");

console.log(`BOUNTY: ${job.bounty_id}`);
console.log(`TITLE: ${job.title ?? "(untitled)"}`);

console.log(
  `PAYOUT: $${(Number(job.payout_cents ?? 0) / 100).toFixed(2)}`
);

console.log("");
console.log("REQUESTED DELIVERABLES");

for (const item of job.deliverables ?? []) {
  console.log(
    ` - ${
      typeof item === "string"
        ? item
        : item.name ?? item.id
    }`
  );
}

console.log("");
console.log("PROPOSED ARTIFACTS");

for (const artifact of manifest.artifacts ?? []) {
  console.log(
    ` ${artifact.exists === true ? "PASS" : "FAIL"} ` +
    `${artifact.name ?? artifact.deliverable_id}`
  );
}

console.log("");
console.log("TESTS");

for (const test of manifest.tests ?? []) {
  console.log(
    ` ${test.passed === true ? "PASS" : "FAIL"} ` +
    `${test.name ?? "unnamed"}`
  );
}

console.log("");
console.log("ACCEPTANCE CRITERIA");

for (const criterion of manifest.criteria ?? []) {
  console.log(
    ` ${criterion.passed === true ? "PASS" : "FAIL"} ` +
    `${criterion.criterion_id ?? "unnamed"}`
  );
}

console.log("");
console.log(
  `SECRET SCAN: ${
    manifest.secret_scan?.passed === true
      ? "PASS"
      : "FAIL"
  }`
);

console.log("");
console.log(
  `SUBMISSION READY: ${result.ready ? "YES" : "NO"}`
);

if (result.failures.length) {
  console.log("");
  console.log("BLOCKERS");

  for (const failure of result.failures) {
    console.log(` - ${failure}`);
  }
}

if (result.warnings.length) {
  console.log("");
  console.log("WARNINGS");

  for (const warning of result.warnings) {
    console.log(` - ${warning}`);
  }
}

console.log("========================================");

process.exit(result.ready ? 0 : 3);
