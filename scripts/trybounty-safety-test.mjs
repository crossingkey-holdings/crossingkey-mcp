import {
  createJobSpec
} from "../lib/trybounty/job-spec.mjs";

import {
  createSubmissionManifest
} from "../lib/trybounty/submission-manifest.mjs";

import {
  createApproval
} from "../lib/trybounty/approval.mjs";

import {
  submissionGate
} from "../lib/trybounty/submission-gate.mjs";

const job = createJobSpec({
  bounty: {
    id: "SAFETY-TEST",
    version: 1,
    title: "CrossingKey submission safety test",
    payout_cents: 10000
  },

  deliverables: [
    "implementation",
    "README"
  ],

  acceptanceCriteria: [
    "tests-pass",
    "matches-scope"
  ]
});

/*
 * BAD manifest.
 * This MUST be blocked.
 */
const bad = createSubmissionManifest({
  jobSpec: job,

  artifacts: [
    {
      deliverable_id: "implementation",
      name: "implementation",
      exists: true
    }
  ],

  tests: [
    {
      name: "test-suite",
      passed: false
    }
  ],

  criteria: [
    {
      criterion_id: "tests-pass",
      passed: false
    }
  ],

  secretScan: {
    passed: true
  }
});

const badApproval = createApproval({
  bountyId: job.bounty_id,
  jobSpecHash: job.spec_hash,
  manifestHash: bad.manifest_hash
});

const blocked = submissionGate({
  jobSpec: job,
  manifest: bad,
  approval: badApproval
});

if (blocked.allowed) {
  throw new Error(
    "CRITICAL: invalid submission escaped gate"
  );
}

console.log(
  "PASS: incomplete/failing submission was blocked."
);

/*
 * GOOD manifest.
 */
const good = createSubmissionManifest({
  jobSpec: job,

  artifacts: [
    {
      deliverable_id: "implementation",
      name: "implementation",
      exists: true
    },
    {
      deliverable_id: "README",
      name: "README",
      exists: true
    }
  ],

  tests: [
    {
      name: "test-suite",
      passed: true
    }
  ],

  criteria: [
    {
      criterion_id: "tests-pass",
      passed: true
    },
    {
      criterion_id: "matches-scope",
      passed: true
    }
  ],

  secretScan: {
    passed: true
  }
});

/*
 * Even valid work without approval MUST be blocked.
 */
const noApproval = submissionGate({
  jobSpec: job,
  manifest: good,
  approval: null
});

if (noApproval.allowed) {
  throw new Error(
    "CRITICAL: submission escaped human approval gate"
  );
}

console.log(
  "PASS: valid work without human approval was blocked."
);

const approval = createApproval({
  bountyId: job.bounty_id,
  jobSpecHash: job.spec_hash,
  manifestHash: good.manifest_hash
});

const allowed = submissionGate({
  jobSpec: job,
  manifest: good,
  approval
});

if (!allowed.allowed) {
  throw new Error(
    `Valid approved submission unexpectedly blocked: ${
      JSON.stringify(allowed)
    }`
  );
}

console.log(
  "PASS: only validated + matching approved submission passed."
);

console.log(
  JSON.stringify({
    safety_test: "PASS",
    bad_submission_blocked: true,
    unapproved_submission_blocked: true,
    approved_valid_submission_allowed: true
  }, null, 2)
);
