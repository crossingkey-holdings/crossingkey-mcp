import crypto from "node:crypto";

export function createApproval({
  bountyId,
  jobSpecHash,
  manifestHash,
  approvedBy = "founder"
}) {
  if (!bountyId || !jobSpecHash || !manifestHash) {
    throw new Error("Incomplete approval request");
  }

  const approvedAt = new Date().toISOString();

  const approvalId = crypto
    .createHash("sha256")
    .update(
      [
        bountyId,
        jobSpecHash,
        manifestHash,
        approvedBy,
        approvedAt
      ].join(":")
    )
    .digest("hex");

  return {
    schema: "crossingkey.submission-approval.v1",

    approval_id: approvalId,
    bounty_id: bountyId,

    job_spec_hash: jobSpecHash,
    manifest_hash: manifestHash,

    approved_by: approvedBy,
    approved_at: approvedAt
  };
}

export function approvalMatches({
  approval,
  jobSpec,
  manifest
}) {
  return Boolean(
    approval &&
    jobSpec &&
    manifest &&
    approval.bounty_id === jobSpec.bounty_id &&
    approval.job_spec_hash === jobSpec.spec_hash &&
    approval.manifest_hash === manifest.manifest_hash
  );
}
