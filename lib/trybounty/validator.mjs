export function validateSubmission(job, manifest) {
  const failures = [];
  const warnings = [];

  if (!job?.bounty_id) {
    failures.push("JOB_SPEC has no bounty_id");
  }

  if (!job?.spec_hash) {
    failures.push("JOB_SPEC has no spec_hash");
  }

  if (manifest?.bounty_id !== job?.bounty_id) {
    failures.push("Manifest bounty_id does not match JOB_SPEC");
  }

  if (manifest?.job_spec_hash !== job?.spec_hash) {
    failures.push("Manifest was not produced from current JOB_SPEC");
  }

  const artifacts = manifest?.artifacts ?? [];
  const tests = manifest?.tests ?? [];
  const criteria = manifest?.criteria ?? [];

  /*
   * Required deliverables must be explicitly represented.
   */
  for (const required of job?.deliverables ?? []) {
    const id =
      typeof required === "string"
        ? required
        : required?.id ?? required?.name;

    if (!id) {
      failures.push("JOB_SPEC contains unidentified deliverable");
      continue;
    }

    const match = artifacts.find(
      a =>
        a?.deliverable_id === id ||
        a?.name === id
    );

    if (!match) {
      failures.push(`Missing required deliverable: ${id}`);
      continue;
    }

    if (match.exists !== true) {
      failures.push(`Deliverable not verified to exist: ${id}`);
    }
  }

  /*
   * Explicit acceptance criteria must all pass.
   */
  for (const required of job?.acceptance_criteria ?? []) {
    const id =
      typeof required === "string"
        ? required
        : required?.id ?? required?.name;

    if (!id) {
      failures.push("JOB_SPEC contains unidentified acceptance criterion");
      continue;
    }

    const result = criteria.find(
      c => c?.criterion_id === id
    );

    if (!result) {
      failures.push(`Acceptance criterion not evaluated: ${id}`);
      continue;
    }

    if (result.passed !== true) {
      failures.push(`Acceptance criterion failed: ${id}`);
    }
  }

  /*
   * Any declared failing test blocks submission.
   */
  for (const test of tests) {
    if (test?.passed !== true) {
      failures.push(
        `Test failed: ${test?.name ?? "unnamed test"}`
      );
    }
  }

  /*
   * A secret scan must explicitly pass.
   */
  if (!manifest?.secret_scan) {
    failures.push("Secret scan was not performed");
  } else if (manifest.secret_scan.passed !== true) {
    failures.push("Secret scan failed");
  }

  if ((job?.deliverables ?? []).length === 0) {
    warnings.push("No explicit deliverables extracted from Bounty");
  }

  if ((job?.acceptance_criteria ?? []).length === 0) {
    warnings.push("No explicit acceptance criteria extracted from Bounty");
  }

  /*
   * Ambiguity never silently becomes permission.
   */
  const ambiguity =
    (job?.deliverables ?? []).length === 0 ||
    (job?.acceptance_criteria ?? []).length === 0;

  if (ambiguity) {
    failures.push(
      "JOB_SPEC is ambiguous; human clarification/approval required"
    );
  }

  return {
    ready: failures.length === 0,
    failures,
    warnings,

    summary: {
      required_deliverables:
        job?.deliverables?.length ?? 0,

      supplied_artifacts:
        artifacts.length,

      acceptance_criteria:
        job?.acceptance_criteria?.length ?? 0,

      tests:
        tests.length
    }
  };
}
