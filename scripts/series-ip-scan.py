#!/usr/bin/env python3
from pathlib import Path
import argparse, json, re, hashlib, sys

TEXT_EXTS = {".md",".txt",".json",".jsonl",".yaml",".yml",".toml",".py",".js",".mjs",".cjs",".ts",".tsx",".jsx",".html",".css",".xml",".csv",".xkey"}

ap = argparse.ArgumentParser()
ap.add_argument("target")
ap.add_argument("--config", required=True)
ap.add_argument("--report", required=True)
ap.add_argument("--max-bytes", type=int, default=2_000_000)
args = ap.parse_args()

target = Path(args.target).resolve()
cfg = json.loads(Path(args.config).read_text())
deny = [re.compile(p) for p in cfg.get("deny_exact_or_regex",[])]
allow = [re.compile(p) for p in cfg.get("allow_exact_or_regex",[])]

matches=[]
scanned=0
skipped=[]

def allowed_context(text, start, end):
    chunk = text[max(0,start-80):min(len(text),end+80)]
    return any(p.search(chunk) for p in allow)

files = [target] if target.is_file() else [p for p in target.rglob("*") if p.is_file()]
for p in files:
    try:
        if p.suffix.lower() not in TEXT_EXTS:
            skipped.append({"path":str(p),"reason":"non_text_extension"})
            continue
        if p.stat().st_size > args.max_bytes:
            skipped.append({"path":str(p),"reason":"size_limit"})
            continue
        raw = p.read_text(errors="replace")
        scanned += 1
        for rx in deny:
            for m in rx.finditer(raw):
                if allowed_context(raw, m.start(), m.end()):
                    continue
                matches.append({
                    "path": str(p),
                    "line": raw.count("\n",0,m.start())+1,
                    "pattern": rx.pattern,
                    "match_hash": hashlib.sha256(m.group(0).encode()).hexdigest()
                })
    except Exception as e:
        skipped.append({"path":str(p),"reason":"read_error","detail":str(e)[:200]})

status = "PASS" if not matches else "BLOCK"
report = {
    "schema":"crossingkey-series-ip-scan-report-v1",
    "target":str(target),
    "status":status,
    "files_scanned":scanned,
    "matches":matches,
    "skipped":skipped,
    "note":"PASS means no configured deny-pattern matches were found. It is not proof that every private-series identifier is absent unless the local deny-pattern file is complete."
}
Path(args.report).write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
sys.exit(0 if status=="PASS" else 3)
