# Provider onboarding

1. Call provider.register with displayName, slug, description, website (optional) and contact. It creates a pending application. Contacts are not returned in public metadata. creator.apply is a private intake path and grants no ownership or account authority.
2. An operator reviews identity, licensing, endpoint behavior, delivery and obligations. Using an administrator principal, set provider status active. Registration never issues provider credentials automatically.
3. The operator provisions an expiring bearer credential through an existing secure channel and stores only its SHA-256 digest in MARKETPLACE_AUTH_FILE. Bind the principal to the exact providerId. Do not paste credentials into MCP arguments or documentation.
4. The provider calls capability.register with the manifest in CAPABILITY-MANIFEST.md. Its providerId must match the authenticated principal; providers cannot register for another tenant. The provider must affirm distribution and commercialization rights. Registration creates planned metadata.
5. The operator binds the capabilityId to a reviewed adapter in the private adapter file. The adapter cannot be selected by a provider manifest. Then capability.setStatus activates it after preflight. Set visibility=public only with current publication approval.

Provider states: pending, active, suspended, rejected. Capability states: planned, beta, active, disabled. Suspending a provider hides its capabilities and blocks new purchases. Existing paid digital entitlements remain available unless separately suspended for an incident; disabling new sales does not silently revoke an existing license.

Search is deterministic: exact name, matching category and actual successful/failed job counts, then name and ID tie breaks. New providers display NEW / UNRATED. There is no invented score, paid placement, client or revenue history. Activation is an operational review, not a legal guarantee of identity or rights.

Provider or administrator credentials can inspect their allocation list and balances. Providers cannot settle balances, change status, create human purchase approvals or access another provider's private records. Buyer identity is supplied by authenticated configuration, never by a caller-controlled buyerReference field in a purchase.
