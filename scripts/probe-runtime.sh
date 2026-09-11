#!/usr/bin/env bash
set -euo pipefail
echo "=== XKEY VERIFIED CANDIDATE ==="
X="$HOME/CrossingKey_Agentic_OS/target/release/xkey"
file "$X"
sha256sum "$X"
echo
echo "=== CCMB STRUCTURE ==="
python3 - "$HOME/Downloads/CK Gemini/ccmb_crawler.py" <<'PY'
import ast,pathlib,sys
p=pathlib.Path(sys.argv[1])
t=ast.parse(p.read_text(errors="replace"))
for n in t.body:
    if isinstance(n,ast.ClassDef):
        print("CLASS:",n.name)
        for x in n.body:
            if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef)):
                print(" METHOD:",x.name,"ARGS:",[a.arg for a in x.args.args])
PY
echo
echo "=== CCMB LEDGER ==="
sqlite3 -readonly "$HOME/Downloads/CK Gemini/ccmb_ledger.db" '.schema' 2>/dev/null || true
