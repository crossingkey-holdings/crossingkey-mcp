import { validateSubmission } from "./validator.mjs";
import { approvalMatches } from "./approval.mjs";

export function submissionGate({
  jobSpec,
  manifest,
  approval
}) {
  const validation = validateSubmission(
    jobSpec,
    manifest
  );

  const humanApproved = approvalMatches({
    approval,
    jobSpec,
    manifest
  });

  return {
    allowed:
      validation.ready === true &&
      humanApproved === true,

    validation_ready:
      validation.ready,

    human_approved:
      humanApproved,

    failures: validation.failures,

    warnings: validation.warnings
  };
}
