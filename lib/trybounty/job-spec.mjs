import crypto from "node:crypto";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, stable(value[k])])
    );
  }

  return value;
}

export function hashObject(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

export function createJobSpec({
  bounty,
  deliverables = [],
  acceptanceCriteria = [],
  requiredFiles = [],
  buyerMessages = []
}) {
  const bountyId = bounty?._id ?? bounty?.id;

  if (!bountyId) {
    throw new Error("Cannot create JOB_SPEC without bounty ID");
  }

  const spec = {
    schema: "crossingkey.job-spec.v1",

    bounty_id: bountyId,

    bounty_version:
      bounty?.version ??
      bounty?.bounty_version ??
      bounty?.updated_at ??
      bounty?.updatedAt ??
      null,

    title: bounty?.title ?? null,
    description: bounty?.description ?? null,

    payout_cents: Number(bounty?.payout_cents ?? 0),

    deadline:
      bounty?.deadline ??
      bounty?.due_at ??
      bounty?.dueAt ??
      null,

    deliverables,
    acceptance_criteria: acceptanceCriteria,
    required_files: requiredFiles,
    buyer_messages: buyerMessages,

    frozen_at: new Date().toISOString()
  };

  return {
    ...spec,
    spec_hash: hashObject(spec)
  };
}
