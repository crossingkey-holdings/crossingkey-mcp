# v4.0.0-rc.1 rollback procedure

This RC has not been deployed. The safe rollback is therefore to discard or
archive the isolated working-tree changes after review and continue using the
unchanged authoritative source/production application.

If a later authorized promotion occurs:

1. Preserve the exact promoted candidate hash and release manifest.
2. Quiesce the service and verify the approved backup of the production source.
3. Restore the prior approved release files only; do not restore mutable data
   over newer state without an explicit state-recovery decision.
4. Perform one bounded restart maximum, then read back PID, timestamp, journal,
   health, version, and payment-discovery surfaces.
5. Confirm receiver-only mode, payment challenge behavior, receipt integrity,
   and no unexpected writes before declaring rollback complete.

No rollback command is executed by this development task.
