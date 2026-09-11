#!/usr/bin/env bash
set -euo pipefail

APP="$HOME/Downloads/crossingkey_developer_revenue_app"
BIN="$HOME/.local/bin"
KEYDIR="$HOME/.config/crossingkey/mcp-registry"
KEY="$KEYDIR/registry-ed25519.pem"

cd "$APP"

mkdir -p "$BIN" "$KEYDIR"
chmod 700 "$KEYDIR"

echo "=== INSTALL MCP PUBLISHER ==="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL \
  "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
  -o "$TMP/publisher.tar.gz"

tar -xzf "$TMP/publisher.tar.gz" -C "$TMP" mcp-publisher
install -m 0755 "$TMP/mcp-publisher" "$BIN/mcp-publisher"

export PATH="$BIN:$PATH"

echo "publisher: $(command -v mcp-publisher)"

echo
echo "=== CREATE REGISTRY SIGNING KEY ==="

if [ ! -f "$KEY" ]; then
    openssl genpkey -algorithm Ed25519 -out "$KEY"
    chmod 600 "$KEY"
    echo "Created protected key: $KEY"
else
    echo "Existing protected key retained: $KEY"
fi

PUBLIC_KEY="$(
  openssl pkey -in "$KEY" -pubout -outform DER |
  tail -c 32 |
  base64 -w0
)"

echo
echo "=== CREATE SERVER METADATA ==="

cat > "$APP/server.json" <<'JSON'
{
  "name": "com.crossingkeyintelligence/revenue-mcp",
  "description": "CrossingKey Intelligence remote MCP server for machine-readable offer discovery, prepaid request credits, fulfillment status, and bounded paid XKEY intake validation.",
  "version": "2.1.0",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://mcp.crossingkeyintelligence.com/mcp"
    }
  ]
}
JSON

echo
echo "=== VALIDATE SERVER.JSON ==="

mcp-publisher validate "$APP/server.json"

echo
echo "=== DNS RECORD TO ADD IN CLOUDFLARE ==="
echo
echo "Type: TXT"
echo "Name: @"
echo "Value:"
echo "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}"
echo
echo "IMPORTANT: record goes on the DOMAIN APEX."
echo "Do not use _mcp, _mcp-registry, or another selector."
echo
echo "Private key remains only at:"
echo "$KEY"
echo
echo "======================================="
echo "MCP DISCOVERY PREP READY"
echo "======================================="
