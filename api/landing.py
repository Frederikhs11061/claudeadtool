"""
Vercel serverless API for landing page audit.
Uses scripts/fetch_page.py and same result/grading structure as scripts/analyze_landing.py.
"""
import json
import re
import sys
from urllib.parse import parse_qs, urlparse

# Allow importing from repo scripts
sys.path.insert(0, ".")
from scripts.fetch_page import fetch_page


def parse_html(html):
    """Extract same data as analyze_landing.py, from HTML string (no Playwright)."""
    def strip(s):
        return re.sub(r"<[^>]+>", " ", s or "").strip() if s else ""

    result = {
        "performance": {"lcp_ms": None, "cls": None, "ttfb_ms": None, "dom_content_loaded_ms": None},
        "content": {"title": None, "h1": None, "meta_description": None, "word_count": 0},
        "conversion": {"cta_above_fold": False, "form_present": False, "form_fields": 0, "phone_number": False, "chat_widget": False},
        "trust": {"testimonials": False, "trust_badges": False, "reviews_schema": False},
        "mobile": {"viewport_meta": False, "horizontal_scroll": False, "font_readable": True},
        "schema": {"types_found": [], "product_schema": False, "faq_schema": False, "service_schema": False},
    }

    # Title
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.I)
    result["content"]["title"] = strip(m.group(1)) if m else None

    # H1
    m = re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html, re.I)
    result["content"]["h1"] = strip(m.group(1)) if m else None

    # Meta description
    m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)["\']', html, re.I)
    if not m:
        m = re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']description["\']', html, re.I)
    result["content"]["meta_description"] = m.group(1).strip() if m else None

    # Viewport
    result["mobile"]["viewport_meta"] = bool(re.search(r'<meta[^>]+name=["\']viewport["\']', html, re.I))

    # Word count from body
    body_m = re.search(r"<body[^>]*>([\s\S]*?)</body>", html, re.I)
    body = body_m.group(1) if body_m else html
    result["content"]["word_count"] = len(strip(body).split())

    # Forms
    forms = re.findall(r"<form[^>]*>", body, re.I)
    result["conversion"]["form_present"] = len(forms) > 0
    inputs = re.findall(r"<input[^>]+type=["\'](?!hidden|submit|button)([^"\']*)["\']", body, re.I)
    result["conversion"]["form_fields"] = len(inputs) if inputs else 0

    # Phone
    result["conversion"]["phone_number"] = bool(re.search(r'href=["\']tel:', html, re.I))

    # Schema (from analyze_landing.py logic)
    schemas = []
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', html, re.I):
        try:
            data = json.loads(m.group(1))
            if data.get("@type"):
                schemas.append(data["@type"])
            for item in (data.get("@graph") or []):
                if item.get("@type"):
                    schemas.append(item["@type"])
        except Exception:
            pass
    result["schema"]["types_found"] = schemas
    result["schema"]["product_schema"] = "Product" in schemas
    result["schema"]["faq_schema"] = "FAQPage" in schemas
    result["schema"]["service_schema"] = "Service" in schemas
    result["trust"]["reviews_schema"] = "Review" in schemas or "AggregateRating" in schemas

    # Trust (from page text, like analyze_landing)
    text = strip(body).lower()
    result["trust"]["testimonials"] = any(k in text for k in ["testimonial", "customer said", "what our"])
    result["trust"]["trust_badges"] = any(k in text for k in ["trusted by", "as seen", "certified", "award"])

    return result


def grade_landing(result):
    """Same logic as scripts/analyze_landing.py grade_landing()."""
    grades = {}
    perf = result["performance"]
    content = result["content"]
    conv = result["conversion"]
    mobile = result["mobile"]
    schema = result["schema"]

    lcp = perf.get("lcp_ms")
    if lcp is not None:
        grades["G59_mobile_speed"] = "PASS" if lcp < 2500 else "WARNING" if lcp < 4000 else "FAIL"

    grades["G60_relevance"] = "PASS" if content["h1"] else "FAIL"

    has_schema = schema["product_schema"] or schema["faq_schema"] or schema["service_schema"]
    grades["G61_schema"] = "PASS" if has_schema else "FAIL"

    grades["cta_above_fold"] = "PASS" if conv["cta_above_fold"] else "FAIL"

    has_viewport = mobile["viewport_meta"]
    no_scroll = not mobile["horizontal_scroll"]
    grades["mobile_responsive"] = "PASS" if (has_viewport and no_scroll) else "FAIL"

    if conv["form_present"]:
        fields = conv["form_fields"]
        grades["form_friction"] = "PASS" if fields <= 5 else "WARNING" if fields <= 8 else "FAIL"

    return grades


def analyze_from_html(fetch_result):
    """Build full result using fetch_page output and analyze_landing structure."""
    if fetch_result["error"]:
        return {"url": fetch_result["url"], "error": fetch_result["error"], "checks": [], "grades": {}}
    html = fetch_result["content"] or ""
    if fetch_result.get("status_code", 0) != 200:
        return {"url": fetch_result["url"], "error": f"HTTP {fetch_result.get('status_code')}", "checks": [], "grades": {}}

    data = parse_html(html)
    data["url"] = fetch_result["url"]
    data["error"] = None

    grades = grade_landing(data)

    # Convert to checks format for frontend (same info, different shape)
    checks = []
    for name, grade in grades.items():
        status = "pass" if grade == "PASS" else "fail" if grade == "FAIL" else "warn"
        msg = {"G59_mobile_speed": "Mobile LCP", "G60_relevance": "H1", "G61_schema": "Schema", "cta_above_fold": "CTA above fold", "mobile_responsive": "Mobile viewport", "form_friction": "Form fields"}.get(name, name)
        checks.append({"name": name, "status": status, "message": msg, "value": grade})

    return {"url": data["url"], "error": None, "data": data, "grades": grades, "checks": checks}


from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        return self._handle()

    def do_POST(self):
        return self._handle()

    def _handle(self):
        url_param = None
        parsed = urlparse(self.path)
        if parsed.query:
            qs = parse_qs(parsed.query)
            url_param = (qs.get("url") or [None])[0]
        if not url_param and self.command == "POST":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8")
                data = json.loads(body) if body else {}
                url_param = data.get("url")
            except Exception:
                pass

        if not url_param or not isinstance(url_param, str):
            self._json(400, {"error": "Angiv url (?url=... eller body {\"url\": \"...\"})"})
            return

        url = url_param.strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url

        fetch_result = fetch_page(url, timeout=15)
        out = analyze_from_html(fetch_result)
        self._json(200, out)

    def _json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
