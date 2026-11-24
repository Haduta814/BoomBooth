"""GET  /api/state?wristband=WB-XXXX   -> {"state": {...} | null}
POST /api/state  {"wristband_id": "...", "state": {...}}

Keeps each wristband's progress (class, quest branch, step, echoes heard),
so a visitor can come back to the booth and carry on.
"""
import json
import os
import re
import sys
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import JsonHandler, supa, supa_ready  # noqa: E402

WB_RE = re.compile(r"^WB-[A-Z0-9]{3,8}$")


class handler(JsonHandler):
    def do_GET(self):
        if not supa_ready():
            return self.send_json(503, {"error": "storage_off"})
        wb = (self.query().get("wristband") or [""])[0].upper()
        if not WB_RE.match(wb):
            return self.send_json(400, {"error": "bad_wristband"})
        status, body, _ = supa("GET", "wristbands?select=state&wristband_id=eq." + urllib.parse.quote(wb))
        if status != 200:
            return self.send_json(502, {"error": "read_failed"})
        return self.send_json(200, {"state": body[0]["state"] if body else None})

    def do_POST(self):
        if not supa_ready():
            return self.send_json(503, {"error": "storage_off"})
        try:
            req = self.read_json()
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "bad_request"})
        wb = str(req.get("wristband_id") or "").upper()
        state = req.get("state")
        if not WB_RE.match(wb) or not isinstance(state, dict) or len(json.dumps(state)) > 20000:
            return self.send_json(400, {"error": "bad_state"})
        status, body, _ = supa("POST", "wristbands?on_conflict=wristband_id",
                               [{"wristband_id": wb, "state": state, "updated_at": datetime.now(timezone.utc).isoformat()}],
                               {"Prefer": "resolution=merge-duplicates,return=minimal"})
        if status >= 300:
            return self.send_json(502, {"error": "write_failed", "detail": body})
        return self.send_json(200, {"ok": True})
