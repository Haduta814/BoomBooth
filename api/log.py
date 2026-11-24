"""POST /api/log

Saves a session record and a batch of events. Called every few seconds while a call
is active, and once more when the visitor hangs up.

Request: {"session": {"session_id": "...", "wristband_id": "...", ...}, "events": [{...}, ...]}
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import JsonHandler, clip, supa, supa_ready  # noqa: E402

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
SESSION_FIELDS = {"session_id": 40, "wristband_id": 40, "mode": 20, "started_at": 40, "ended_at": 40,
                  "end_reason": 40, "voice": 20, "user_agent": 200}


class handler(JsonHandler):
    def do_POST(self):
        if not supa_ready():
            return self.send_json(503, {"error": "storage_off"})
        try:
            req = self.read_json()
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "bad_request"})

        session = req.get("session") or {}
        sid = session.get("session_id") or ""
        if not ID_RE.match(sid):
            return self.send_json(400, {"error": "bad_session"})
        row = {k: clip(session.get(k), n) or None for k, n in SESSION_FIELDS.items() if k in session}
        row["session_id"] = sid
        status, body, _ = supa("POST", "sessions?on_conflict=session_id", [row],
                               {"Prefer": "resolution=merge-duplicates,return=minimal"})
        if status >= 300:
            return self.send_json(502, {"error": "session_write_failed", "detail": body})

        events = []
        for ev in (req.get("events") or [])[:200]:
            if not isinstance(ev, dict):
                continue
            data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
            data_text = json.dumps(data)[:4000]
            events.append({
                "session_id": sid,
                "wristband_id": clip(ev.get("wristband_id") or session.get("wristband_id"), 40) or None,
                "at": clip(ev.get("at"), 40) or None,
                "screen": clip(ev.get("screen"), 40) or None,
                "type": clip(ev.get("type"), 40) or "unknown",
                "data": json.loads(data_text) if len(data_text) < 4000 else {"truncated": True},
            })
        if events:
            status, body, _ = supa("POST", "events", events, {"Prefer": "return=minimal"})
            if status >= 300:
                return self.send_json(502, {"error": "event_write_failed", "detail": body})
        return self.send_json(200, {"ok": True, "saved": len(events)})
