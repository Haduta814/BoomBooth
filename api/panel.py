"""GET  /api/panel            -> all sessions and events (passcode required)
POST /api/panel {"action": "clear", "confirm": "DELETE"} -> deletes all test data

The passcode is sent in the x-panel-passcode header and checked against the
PANEL_PASSCODE environment variable.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import JsonHandler, ai_enabled, env, supa, supa_ready, supa_select_all  # noqa: E402


class handler(JsonHandler):
    def do_GET(self):
        if not env("PANEL_PASSCODE"):
            return self.send_json(503, {"error": "no_passcode_set"})
        if not self.passcode_ok():
            return self.send_json(401, {"error": "wrong_passcode"})
        if not supa_ready():
            return self.send_json(503, {"error": "storage_off"})
        try:
            sessions = supa_select_all("sessions", "select=*&order=started_at.desc")
            events = supa_select_all("events", "select=session_id,wristband_id,at,screen,type,data&order=id.asc")
        except RuntimeError as err:
            return self.send_json(502, {"error": "read_failed", "detail": str(err)})
        return self.send_json(200, {
            "sessions": sessions,
            "events": events,
            "config": {"ai": ai_enabled(), "tts": ai_enabled() and env("TTS_ENABLED", "true").lower() != "false",
                       "model": env("GEMINI_MODEL", "gemini-3.8-flash")},
        })

    def do_POST(self):
        if not self.passcode_ok():
            return self.send_json(401, {"error": "wrong_passcode"})
        try:
            req = self.read_json()
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "bad_request"})
        if req.get("action") != "clear" or req.get("confirm") != "DELETE":
            return self.send_json(400, {"error": "confirm_required"})
        for path in ("events?id=gte.0", "sessions?session_id=neq.__none__", "wristbands?wristband_id=neq.__none__"):
            status, body, _ = supa("DELETE", path, None, {"Prefer": "return=minimal"})
            if status >= 300:
                return self.send_json(502, {"error": "clear_failed", "detail": body})
        return self.send_json(200, {"ok": True})
