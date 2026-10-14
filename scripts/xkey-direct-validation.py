#!/usr/bin/env python3
"""Offline XKEY normalization adapter; it never opens the credit ledger."""
from __future__ import annotations
import json, os, sys

def main() -> int:
    try:
        root = os.environ.get("XKEY_ROOT", "").strip()
        if not root:
            raise ValueError("XKEY_ROOT is required")
        sys.path.insert(0, os.path.join(root, "src"))
        from xkey_compiler.service import CompilationError, validate_intake_text
        payload = json.load(sys.stdin)
        raw, limit = payload.get("raw_intake"), payload.get("max_input_chars", 100000)
        if not isinstance(raw, str) or not isinstance(limit, int) or isinstance(limit, bool):
            raise ValueError("invalid validation input")
        try:
            normalized = validate_intake_text(raw, max_input_chars=limit, location="paid-validation-input")
        except CompilationError as exc:
            print(json.dumps({"ok": True, "success": False, "state": "SAFE_FAILURE", "error": str(exc)}, separators=(",", ":")))
            return 0
        print(json.dumps({"ok": True, "success": True, "state": "VERIFIED_SUCCESS", "normalized": normalized.model_dump(mode="json")}, separators=(",", ":")))
        return 0
    except Exception:
        print(json.dumps({"ok": False, "error": "validation_runtime_unavailable"}, separators=(",", ":")))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
