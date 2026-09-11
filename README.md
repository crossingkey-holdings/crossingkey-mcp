# CrossingKey Revenue MCP v2

This rebuild intentionally removes the earlier Gumroad catalog, storefront widget, lead capture, recommendation logic, and the checkout-handler mismatch.

It does four jobs:

1. exposes exact Stripe Payment Links through MCP;
2. provisions prepaid request credits from Stripe;
3. verifies Stripe webhooks and creates entitlements only after paid Checkout Sessions;
4. delivers only exact, SHA-256-verified files that have been bound to the delivery directory.

## What is already live in Stripe

Three new prepaid request-credit products and Payment Links were created in live mode:

- 100 credits — $5
- 500 credits — $15
- 2,000 credits — $49

See `data/credit_links.json` for the exact live URLs and Stripe IDs.

## Existing Stripe catalog

`data/stripe_catalog.json` contains the 34 previously verified live CrossingKey Payment Links from the 2026-08-24 Stripe map.

The MCP never invents a link.

## Digital fulfillment

Five exact product/file mappings were recovered from the existing CrossingKey product manifest:

- AI Operator Prompt Library
- Business Systems Template Vault
- Local AI Field Guide
- AI Automation Workshop
- Founder Operations Vault

The server will NOT claim they are ready until the exact ZIP exists under `delivery/` and its SHA-256 matches `data/fulfillment_map.json`.

Bind them from your laptop safely:

```bash
npm run scan:files -- "$HOME/Downloads" "$HOME/Documents" "$HOME/Desktop"
```

The scanner looks only for the five exact known filenames, verifies the recorded SHA-256, checks for common secret patterns, and copies only passing files into `delivery/`.

## Setup

```bash
unzip crossingkey_revenue_mcp_v2.zip
cd crossingkey_revenue_mcp_v2
./bootstrap.sh
nano .env
```

Set your existing Stripe secret key locally. Never paste it into chat.

For local webhook testing, use Stripe CLI if already installed:

```bash
stripe listen --forward-to localhost:3000/stripe/webhook
```

Put the resulting `whsec_...` value in `.env`, then:

```bash
set -a
source .env
set +a
npm start
```

Health:

```bash
curl http://localhost:3000/health
```

MCP:

```text
http://localhost:3000/mcp
```

## Production activation

Once the same server has a public HTTPS URL, set:

```bash
PUBLIC_BASE_URL=https://compute.crossingkeyintelligence.com
```

Then run:

```bash
npm run stripe:webhook:create
```

Store the returned webhook signing secret in `STRIPE_WEBHOOK_SECRET`.

Then update the three credit links so successful buyers are sent directly to the automatic claim page:

```bash
npm run stripe:credits:redirect
```

After that, a credit purchase becomes:

Stripe Payment Link → verified webhook → credit entitlement → `/claim` → buyer receives their `ck_...` request token.

A mapped digital purchase becomes:

Stripe Payment Link → verified webhook → download entitlement → `/claim` → SHA-256-verified download.

## MCP tools

- `list_stripe_offers`
- `get_stripe_checkout_link`
- `get_request_credit_links`
- `get_fulfillment_status`
- `list_request_services`

`list_request_services` intentionally starts empty. The next stage is to scan and approve safe tools/files from the laptop and AI libraries before allowing paid execution.

## Security rules

- no Gumroad
- no card data
- no unverified payment status
- no delivery before Stripe reports paid
- no arbitrary shell execution
- no automatic exposure of laptop/ChatGPT/Gemini/Claude/Grok files
- no private keys, `.env`, tokens, secrets, personal data, or private canon in delivery

## Ownership and publication

Original covered material uses the [CrossingKey Proprietary License](LICENSE).
See the [ownership boundary](docs/crossingkey-publication/PROPRIETARY.md), [architecture](docs/crossingkey-publication/ARCHITECTURE.md),
[security notes](docs/crossingkey-publication/SECURITY.md), and
[evidence status](docs/crossingkey-publication/EVIDENCE.md).
