# Capability manifest contract

Required: providerId, name, slug, description, category, version (semantic x.y.z), inputSchema, outputSchema, deliveryType, price, currency, network, license, sourceProvenance and rights. Optional: executionEndpoint, visibility (private by default), contentHash.

price is a positive decimal string of at most 30 digits in USDC atomic units. currency is USDC. network is eip155:84532 or eip155:8453 and must match the existing core before quoting or purchase. Fee and provider share are calculated server-side. Neither the receiver nor settlement destination is supplied by the provider.

deliveryType: mcp_tool, api, digital_asset, workflow, service, dataset, content, software or other. This taxonomy describes the offer, not a promise that every adapter is configured. Execution is limited to an operator binding of local, http, mcp or digital_asset. Local adapters must be explicitly registered JavaScript functions in trusted application code; provider manifests cannot load modules or execute shell commands. This build's echo adapter exists only in tests.

Supported JSON Schema subset: type, description, properties, required, additionalProperties, items, minItems/maxItems, minLength/maxLength, minimum/maximum and primitive enum. Types: object, array, string, number, integer, boolean and null. Objects require additionalProperties=false and explicit properties. Arrays require maxItems<=1000 and an item schema; strings require maxLength<=32768. Schema depth<=6 and schema size<=16 KiB. Remote refs, regexes, combinators and unknown keywords are rejected, not silently ignored. Purchases accept object inputs, so use an object inputSchema.

Tool arguments and purchase payloads are bounded to 64 KiB, 4000 JSON nodes and depth 16. Adapter results are bounded to 256 KiB. Artifact hashes are SHA-256 over bytes; receipt/result hashes use the existing deterministic JSON hash convention. Digital-asset activation requires a matching configured artifact and contentHash.

Rights include ownershipRepresentation, distributionPermission=true, commercializationPermission=true, affirmed=true, revocationPolicy, optional derivativePermission and optional aiTrainingPermission (both false by default). The server adds affirmationTimestamp and affirmationVersion=ck-rights/1. Provenance records version, provider, registration time, source, content hash and a transformations array for future records shaped as sourceHash/operation/outputHash/timestamp. No transformation is fabricated by this build.

Public capability metadata omits execution URL details and all local asset paths. Source provenance rejects common local-path forms. A human still needs to review user-authored public descriptions for private information before activation.
