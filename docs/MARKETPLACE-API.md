# Marketplace MCP API

All new tool schemas are strict objects with bounded fields. Errors return isError=true and a safe errorCode; raw exceptions, paths, credentials and provider responses are not logged or surfaced as error messages. All money fields are strings in USDC atomic units.

| Tool | Contract / authority |
| --- | --- |
| marketplace.describe | Free purpose, policies, counts, fee and planned capabilities |
| provider.register | Free pending application; provider manifest fields |
| provider.get | providerId; public active metadata or owner/admin access |
| provider.setStatus | providerId, status; admin |
| capability.register | Complete rights-affirmed manifest; matching provider/admin |
| capability.setStatus | capabilityId, status, optional visibility; admin |
| capability.get | Exactly one name (legacy) or capabilityId (marketplace) |
| capability.search | Optional query/category/provider/deliveryType/minPrice/maxPrice/offset/limit |
| catalog.list | offset/limit; active public catalog |
| commerce.quote | capabilityId; exact price/allocation and v1/v2 requirements |
| capability.purchase | capabilityId, approvalId, idempotencyKey, object input, signed paymentPayload; authenticated approved buyer |
| job.status | jobId; buyer/provider/admin, no raw input/output |
| receipt.get | receiptId; authorized buyer/admin; compatible receipt plus allocation |
| creator.apply | provider application plus summary; pending private intake |
| settlement.getProviderBalance | providerId; owner/admin, balances grouped by network/currency |
| settlement.listAllocations | providerId/offset/limit; owner/admin |
| settlement.markSettled | allocationId/reference; admin, accounting only |

42 registered tools total: 26 original, capability.get extended in place, 16 additions. Existing free and paid tools remain. MCP taskSupport=forbidden prevents background task execution for the purchase tool, while local human approval is separately enforced by application code. This metadata alone is not the payment authorization control.

HTTP: POST /api/marketplace/purchase with capabilityId and no payment header returns v1 JSON and a v2 PAYMENT-REQUIRED header. Signed requests accept PAYMENT-SIGNATURE, PAYMENT-SIGNED (alias) or X-PAYMENT plus the purchase fields (without paymentPayload), and a buyer Authorization bearer header. Successful settlement yields PAYMENT-RESPONSE and X-PAYMENT-RESPONSE. 200 means verified delivery; 202 means a recorded failure/uncertain job requiring review, so callers must inspect paymentStatus/status/errorCode. Error requests return safe JSON; STORE_BUSY is 409.

GET /api/marketplace/delivery/:entitlementId requires the owning buyer bearer or administrator. The artifact root is operator-controlled, hash checked and bounded; successful authorization consumes one of three digital download attempts. A network interruption after authorization can consume an attempt and requires operator support. The receipt and entitlement remain preserved.

Job lifecycle records quoted, awaiting_payment, paid, executing, delivered, verified or failed/disputed. Refunds and disputes require operator accounting and payment evidence; they never trigger automatic treasury actions. Same request and idempotency key returns the previous response; conflicting requests fail. Network+nonce replay protection is shared with legacy payments. Payment credentials and input are hashed in the purchase journal; buyer-visible delivered output appears in its authorized receipt.
