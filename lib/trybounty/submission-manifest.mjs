import { hashObject } from "./job-spec.mjs";

export function createSubmissionManifest({
  jobSpec,
  artifacts = [],
  tests = [],
  evidence = [],
  criteria = [],
  secretScan = null,
  notes = null
}) {
  if (!jobSpec?.bounty_id || !jobSpec?.spec_hash) {
    throw new Error("Valid JOB_SPEC required");
  }

  const manifest = {
    schema: "crossingkey.submission-manifest.v1",

    bounty_id: jobSpec.bounty_id,
    job_spec_hash: jobSpec.spec_hash,

    artifacts,
    tests,
    evidence,
    criteria,

    secret_scan: secretScan,

    notes,

    generated_at: new Date().toISOString()
  };

  return {
    ...manifest,
    manifest_hash: hashObject(manifest)
  };
}
