"""Shared helpers for the BoomBooth serverless functions.

Standard library only, so there is nothing to install on Vercel.
Secrets come from environment variables and never reach the browser.
"""
import base64
import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

GEMINI_BASE = os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/models")
MAX_BODY = 200_000  # bytes accepted from the browser


def env(name, default=""):
    return os.environ.get(name, default).strip()


def ai_enabled():
    return bool(env("GEMINI_API_KEY")) and env("AI_ENABLED", "true").lower() != "false"


class JsonHandler(BaseHTTPRequestHandler):
    """Base request handler with JSON helpers. Subclasses define do_GET / do_POST."""

    def log_message(self, *args):  # keep Vercel logs quiet
        return

    def read_json(self):
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("Request too large")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") or "{}")

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def query(self):
        return urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

    def passcode_ok(self):
        expected = env("PANEL_PASSCODE")
        given = self.headers.get("x-panel-passcode") or ""
        return bool(expected) and hmac.compare_digest(expected, given)


# ---------- HTTP ----------

def http_json(method, url, headers=None, payload=None, timeout=20):
    """Make a JSON request. Returns (status, parsed_body_or_text, response_headers)."""
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "boombooth-server/1.0")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
            status = resp.status
            resp_headers = dict(resp.headers)
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", "replace")
        status = err.code
        resp_headers = dict(err.headers or {})
    try:
        body = json.loads(text) if text else None
    except json.JSONDecodeError:
        body = text
    return status, body, resp_headers


# ---------- Gemini ----------

def gemini_generate(model, body, timeout=20):
    url = f"{GEMINI_BASE}/{model}:generateContent"
    return http_json("POST", url, {"x-goog-api-key": env("GEMINI_API_KEY")}, body, timeout)


def gemini_text(resp):
    try:
        parts = resp["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return ""
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


def gemini_with_fallback(model, body, timeout=20):
    """Try with the thinking setting; if the model rejects it, retry without."""
    status, resp, _ = gemini_generate(model, body, timeout)
    if status == 400 and "thinkingConfig" in body.get("generationConfig", {}):
        body = json.loads(json.dumps(body))
        body["generationConfig"].pop("thinkingConfig", None)
        status, resp, _ = gemini_generate(model, body, timeout)
    return status, resp


def gemini_audio(text, voice, style, timeout=25):
    model = env("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts")
    part = {"text": text}
    if style:
        part["speech_metadata"] = {"style": style}
    body = {
        "contents": [{"role": "user", "parts": [part]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"voice": voice}},
        },
    }
    status, resp, _ = gemini_generate(model, body, timeout)
    if status != 200:
        return None, status
    try:
        inline = resp["candidates"][0]["content"]["parts"][0]["inlineData"]
        return base64.b64decode(inline["data"]), 200
    except (KeyError, IndexError, TypeError, ValueError):
        return None, 502


# ---------- Supabase (PostgREST) ----------

def supa_headers(extra=None):
    key = env("SUPABASE_SECRET_KEY") or env("SUPABASE_SERVICE_ROLE_KEY")
    headers = {"apikey": key}
    # New sb_secret_ keys go on the apikey header only; legacy JWT keys also need Authorization.
    if key and not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    headers.update(extra or {})
    return headers


def supa_ready():
    return bool(env("SUPABASE_URL")) and bool(env("SUPABASE_SECRET_KEY") or env("SUPABASE_SERVICE_ROLE_KEY"))


def supa(method, path, payload=None, extra_headers=None, timeout=15):
    url = env("SUPABASE_URL").rstrip("/") + "/rest/v1/" + path
    return http_json(method, url, supa_headers(extra_headers), payload, timeout)


def supa_select_all(table, query, page=1000, cap=50_000):
    """Read every row of a query, a page at a time (PostgREST returns at most 1000 per request)."""
    rows, offset = [], 0
    while offset < cap:
        sep = "&" if query else ""
        status, body, _ = supa("GET", f"{table}?{query}{sep}limit={page}&offset={offset}")
        if status != 200 or not isinstance(body, list):
            raise RuntimeError(f"Supabase read failed ({status}): {body}")
        rows.extend(body)
        if len(body) < page:
            break
        offset += page
    return rows


# ---------- Content ----------

_CONTENT = None


def content():
    """The booth's content file, read from the deployed public folder."""
    global _CONTENT
    if _CONTENT is None:
        here = os.path.dirname(os.path.abspath(__file__))
        for path in (
            os.path.join(here, "..", "public", "content", "content.json"),
            os.path.join(os.getcwd(), "public", "content", "content.json"),
        ):
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    _CONTENT = json.load(f)
                break
        else:
            _CONTENT = {}
    return _CONTENT


def clip(value, limit):
    return str(value or "")[:limit]
