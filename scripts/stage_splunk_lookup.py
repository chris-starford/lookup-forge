#!/usr/bin/env python3
"""Stage Splunk lookup rows for the Cribl Lookup Forge.

Reads rows (JSON array, NDJSON or CSV) and sends them to a Cribl Splunk HEC source as
sourcetype "cribl:lookup:staging". A Cribl route writes them to the Lake dataset
"lookup_staging", where the Lookup Forge's "Splunk via Lake staging" source picks up
the newest sync and publishes it to Cribl Stream and Cribl Search.

Used by an AI agent (for example Claude Code with the Splunk MCP server) or by hand:

    export CRIBL_HEC_URL=https://default.main.<workspace>.cribl.cloud:8088/services/collector/event
    export CRIBL_HEC_TOKEN=...            # never pass the token on the command line
    python3 stage_splunk_lookup.py --lookup cmdb_assets.csv --file /tmp/cmdb_assets.json

Standard library only. Python 3.8+.
"""
import argparse
import csv
import io
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

SOURCETYPE = "cribl:lookup:staging"
BATCH = 500


def load_rows(path: str):
    text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8-sig").read()
    stripped = text.lstrip()
    if not stripped:
        return []
    if stripped[0] == "[":
        data = json.loads(text)
        return [r.get("result", r) if isinstance(r, dict) else r for r in data]
    if stripped[0] == "{":
        rows = []
        for line in text.splitlines():
            if line.strip():
                obj = json.loads(line)
                if obj.get("preview") is True:
                    continue
                rows.append(obj.get("result", obj))
        return rows
    return list(csv.DictReader(io.StringIO(text)))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lookup", required=True, help="Splunk lookup name, e.g. cmdb_assets.csv")
    ap.add_argument("--file", required=True, help="Rows as a JSON array, NDJSON or CSV file ('-' for stdin)")
    ap.add_argument("--url", default=os.environ.get("CRIBL_HEC_URL"),
                    help="Cribl HEC event endpoint, e.g. https://default.main.<workspace>.cribl.cloud:8088/services/collector/event (or set CRIBL_HEC_URL)")
    ap.add_argument("--auth-scheme", default="Splunk", help='Authorization scheme prefix (default "Splunk")')
    ap.add_argument("--insecure", action="store_true", help="Skip TLS verification (local testing only)")
    ap.add_argument("--dry-run", action="store_true", help="Show what would be sent without sending")
    args = ap.parse_args()

    if not args.url and not args.dry_run:
        print(json.dumps({"ok": False, "error": "Set CRIBL_HEC_URL or pass --url (your Cribl HEC event endpoint)."}))
        return 2

    rows = [r for r in load_rows(args.file) if isinstance(r, dict)]
    if not rows:
        print(json.dumps({"ok": False, "error": "No rows found in the input."}))
        return 2

    sync_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(2)
    now = time.time()
    events = []
    for r in rows:
        row = {k: v for k, v in r.items() if not str(k).startswith("_")}
        row.update({"splunk_lookup": args.lookup, "sync_id": sync_id})
        events.append({
            "time": now,
            "host": "lookup-agent",
            "source": f"splunk:{args.lookup}",
            "sourcetype": SOURCETYPE,
            "event": row,
            "fields": {"splunk_lookup": args.lookup, "sync_id": sync_id},
        })

    if args.dry_run:
        print(json.dumps({"ok": True, "dry_run": True, "lookup": args.lookup, "sync_id": sync_id, "rows": len(events), "first_event": events[0]}, indent=2))
        return 0

    token = os.environ.get("CRIBL_HEC_TOKEN")
    if not token:
        print(json.dumps({"ok": False, "error": "Set the CRIBL_HEC_TOKEN environment variable."}))
        return 2

    ctx = None
    if args.insecure:
        import ssl
        ctx = ssl._create_unverified_context()

    sent = 0
    for i in range(0, len(events), BATCH):
        body = "\n".join(json.dumps(e, separators=(",", ":")) for e in events[i:i + BATCH]).encode()
        req = urllib.request.Request(args.url, data=body, method="POST", headers={
            "Authorization": f"{args.auth_scheme} {token}",
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            print(json.dumps({"ok": False, "status": e.code, "error": detail, "sent": sent, "sync_id": sync_id}))
            return 1
        except urllib.error.URLError as e:
            print(json.dumps({"ok": False, "error": str(e.reason), "sent": sent, "sync_id": sync_id}))
            return 1
        sent += len(events[i:i + BATCH])

    print(json.dumps({"ok": True, "lookup": args.lookup, "sync_id": sync_id, "rows": sent, "dataset": "lookup_staging"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
