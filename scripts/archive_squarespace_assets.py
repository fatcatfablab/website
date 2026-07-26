#!/usr/bin/env python3
"""Download original first-party Squarespace content assets with provenance."""

from __future__ import annotations

import hashlib
import html
import json
import mimetypes
import pathlib
import re
import urllib.parse
import urllib.request

SOURCE_ROOT = pathlib.Path("research")
OUTPUT_ROOT = pathlib.Path("research/assets")
SITE_CONTENT_PREFIX = "/content/v1/55b820ace4b050d4e61929e6/"
URL_PATTERN = re.compile(r"(?:(?:https?:)?//)[^\s\"'<>\\)]+")


def discover_urls():
    urls = set()
    source_files = list(SOURCE_ROOT.rglob("*.json")) + list(SOURCE_ROOT.rglob("*.html"))
    for path in source_files:
        text = html.unescape(path.read_text(errors="ignore").replace("\\/", "/"))
        for candidate in URL_PATTERN.findall(text):
            if candidate.startswith("//"):
                candidate = "https:" + candidate
            candidate = candidate.rstrip(".,;")
            parsed = urllib.parse.urlparse(candidate)
            if parsed.hostname != "images.squarespace-cdn.com":
                continue
            if not parsed.path.startswith(SITE_CONTENT_PREFIX):
                continue
            canonical = urllib.parse.urlunparse(parsed._replace(scheme="https", query="", fragment=""))
            urls.add(canonical)
    return sorted(urls)


def safe_name(url: str, content_type: str | None):
    parsed = urllib.parse.urlparse(url)
    original = pathlib.Path(urllib.parse.unquote(parsed.path)).name or "asset"
    original = re.sub(r"[^A-Za-z0-9._-]+", "-", original).strip("-") or "asset"
    if not pathlib.Path(original).suffix and content_type:
        original += mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) or ""
    digest = hashlib.sha256(url.encode()).hexdigest()[:12]
    return f"{digest}-{original}"


def main():
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    manifest = []
    failures = []
    urls = discover_urls()
    for index, url in enumerate(urls, start=1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
                content_type = response.headers.get("content-type")
                status = response.status
            name = safe_name(url, content_type)
            path = OUTPUT_ROOT / name
            path.write_bytes(data)
            manifest.append(
                {
                    "sourceUrl": url,
                    "localPath": str(path),
                    "status": status,
                    "contentType": content_type,
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )
            print(f"[{index:02d}/{len(urls):02d}] {len(data):9d} {name}")
        except Exception as exc:
            failures.append({"sourceUrl": url, "error": f"{type(exc).__name__}: {exc}"})
            print(f"[{index:02d}/{len(urls):02d}] ERROR {url}: {exc}")

    (OUTPUT_ROOT / "manifest.json").write_text(
        json.dumps({"assets": manifest, "failures": failures}, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"Archived {len(manifest)} assets; {len(failures)} failures")


if __name__ == "__main__":
    main()
