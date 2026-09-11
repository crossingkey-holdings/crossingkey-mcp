#!/usr/bin/env bash
set -euo pipefail

APP="$HOME/Downloads/crossingkey_developer_revenue_app"
XKEY="$HOME/CrossingKey/control/xkey/06_REVENUE/XKEY-Compiler-Revenue-Agent"

cd "$APP"

echo "CrossingKey Revenue MCP"
echo "Working directory: $PWD"

test -f "$APP/server.mjs" || {
    echo "ERROR: server.mjs missing"
    exit 1
}

test -f "$APP/.env" || {
    echo "ERROR: .env missing"
    exit 1
}

test -x "$XKEY/.venv/bin/python" || {
    echo "ERROR: XKEY Python runtime missing"
    exit 1
}

mkdir -p "$HOME/.config/systemd/user"

cat > "$HOME/.config/systemd/user/crossingkey-revenue-mcp.service" <<EOF
[Unit]
Description=CrossingKey Revenue MCP
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
Environment=PORT=3000
Environment=XKEY_ROOT=$XKEY
Environment=XKEY_PYTHON=$XKEY/.venv/bin/python
Environment=XKEY_CREDIT_DB=$APP/data/xkey_paid_credits.sqlite3
ExecStart=/usr/bin/node $APP/server.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable crossingkey-revenue-mcp.service

# Stop only the previous CrossingKey service if it exists.
systemctl --user stop crossingkey-revenue-mcp.service 2>/dev/null || true

# Refuse to kill an unknown process on the revenue port.
if ss -ltnp 2>/dev/null | grep -q ':3000 '; then
    echo
    echo "PORT 3000 IS ALREADY OCCUPIED."
    echo "Not killing an unknown process automatically."
    ss -ltnp 2>/dev/null | grep ':3000 ' || true
    exit 2
fi

systemctl --user start crossingkey-revenue-mcp.service

sleep 2

echo
echo "=== SERVICE ==="
systemctl --user --no-pager --full status \
    crossingkey-revenue-mcp.service | head -20

echo
echo "=== LOCAL HEALTH ==="
curl -fsS http://127.0.0.1:3000/health
echo

echo
echo "=== PUBLIC HEALTH ==="
curl -fsS https://mcp.crossingkeyintelligence.com/health
echo

echo
echo "======================================"
echo "CROSSINGKEY REVENUE MCP STARTED"
echo "local:  http://127.0.0.1:3000"
echo "public: https://mcp.crossingkeyintelligence.com/mcp"
echo "======================================"
