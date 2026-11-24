"""GET /api/config -> which services are switched on, so the booth can show the right options."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import JsonHandler, ai_enabled, env, supa_ready  # noqa: E402


class handler(JsonHandler):
    def do_GET(self):
        return self.send_json(200, {
            "ai": ai_enabled(),
            "tts": ai_enabled() and env("TTS_ENABLED", "true").lower() != "false",
            "storage": supa_ready(),
        })
