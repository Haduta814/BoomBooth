"""POST /api/tts

Speaks one line with a Gemini voice and returns a WAV file.

Request:  {"text": "...", "voice": "Kore", "style": "calm, warm"}
Response: audio/wav bytes, or JSON error (the page then falls back to the browser voice).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import JsonHandler, ai_enabled, clip, env, gemini_audio  # noqa: E402

VOICES = {
    "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
    "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
    "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
    "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
}


class handler(JsonHandler):
    def do_POST(self):
        if not ai_enabled() or env("TTS_ENABLED", "true").lower() == "false":
            return self.send_json(503, {"error": "tts_off"})
        try:
            req = self.read_json()
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "bad_request"})
        text = clip(req.get("text"), 600).strip()
        voice = req.get("voice") if req.get("voice") in VOICES else "Kore"
        if not text:
            return self.send_json(400, {"error": "missing_text"})
        audio, status = gemini_audio(text, voice, clip(req.get("style"), 120))
        if not audio:
            return self.send_json(502, {"error": "tts_failed", "status": status})
        # Gemini returns a complete WAV by default; wrap raw PCM just in case.
        if not audio.startswith(b"RIFF"):
            audio = wav_from_pcm(audio)
        return self.send_bytes(200, audio, "audio/wav")


def wav_from_pcm(pcm, rate=24000, channels=1, width=2):
    import struct
    byte_rate = rate * channels * width
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack(
        "<IHHIIHH", 16, 1, channels, rate, byte_rate, channels * width, width * 8
    ) + b"data" + struct.pack("<I", len(pcm))
    return header + pcm
