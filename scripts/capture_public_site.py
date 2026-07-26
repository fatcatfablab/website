#!/usr/bin/env python3
"""Capture the public Squarespace site as migration source material.

Reads only public pages. For each sitemap route it stores Squarespace JSON,
rendered DOM metadata, and desktop/mobile full-page screenshots.
"""

from __future__ import annotations

import asyncio
import base64
import json
import pathlib
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import websockets

CDP_LIST = "http://127.0.0.1:9223/json/list"
SITE_ORIGIN = "https://fatcatfablab.org"
OUTPUT = pathlib.Path("research/pages")
SITEMAP = pathlib.Path("research/sitemap.xml")
ADMIN_INVENTORY = pathlib.Path("research/admin-page-inventory.json")


class CDP:
    def __init__(self, websocket_url: str):
        self.websocket_url = websocket_url
        self.ws = None
        self.sequence = 0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.websocket_url, max_size=100_000_000)
        return self

    async def __aexit__(self, *_):
        await self.ws.close()

    async def command(self, method: str, params: dict | None = None, timeout: float = 60):
        self.sequence += 1
        command_id = self.sequence
        await self.ws.send(json.dumps({"id": command_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(await asyncio.wait_for(self.ws.recv(), timeout))
            if message.get("id") == command_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    async def evaluate(self, expression: str, await_promise: bool = False):
        result = await self.command(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
            },
        )
        return result.get("result", {}).get("value")

    async def wait_for(self, expression: str, timeout: float = 30):
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            if await self.evaluate(f"Boolean({expression})"):
                return
            await asyncio.sleep(0.2)
        raise TimeoutError(expression)


def public_target():
    targets = json.load(urllib.request.urlopen(CDP_LIST, timeout=5))
    for target in targets:
        if target.get("type") == "page" and target.get("url", "").startswith(SITE_ORIGIN):
            return target
    raise RuntimeError("Open fatcatfablab.org in the dedicated Brave profile first")


def sitemap_paths():
    root = ET.parse(SITEMAP).getroot()
    namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    paths = [urllib.parse.urlparse(node.findtext("s:loc", namespaces=namespace)).path for node in root.findall("s:url", namespace)]

    # Include enabled public-but-unlinked pages from the authenticated inventory.
    # Squarespace does not place every enabled page in sitemap.xml, particularly
    # sections nested under an index and utility/payment pages.
    if ADMIN_INVENTORY.exists():
        for row in json.loads(ADMIN_INVENTORY.read_text()):
            general = row.get("settings", {}).get("general", {})
            toggles = general.get("visibilityToggles") or []
            enabled = any(toggle.get("value") == "true" and toggle.get("checked") for toggle in toggles)
            slug = general.get("urlSlug")
            if enabled and slug:
                paths.append("/" + slug.strip("/"))

    # Root is the canonical homepage surface even though Squarespace also emits /home.
    return list(dict.fromkeys(["/"] + paths))


def slug_for(path: str):
    return "home" if path == "/" else re.sub(r"[^a-z0-9-]+", "-", path.strip("/").lower()).strip("-")


async def capture_screenshot(cdp: CDP, path: pathlib.Path, width: int, height: int, mobile: bool):
    await cdp.command(
        "Emulation.setDeviceMetricsOverride",
        {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": mobile,
            "screenWidth": width,
            "screenHeight": height,
        },
    )
    await asyncio.sleep(0.35)
    screenshot = await cdp.command(
        "Page.captureScreenshot",
        {"format": "png", "captureBeyondViewport": True, "fromSurface": True},
    )
    path.write_bytes(base64.b64decode(screenshot["data"]))


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    target = public_target()
    routes = sitemap_paths()

    async with CDP(target["webSocketDebuggerUrl"]) as cdp:
        await cdp.command("Page.enable")
        await cdp.command("Runtime.enable")

        for index, route in enumerate(routes, start=1):
            page_dir = OUTPUT / slug_for(route)
            page_dir.mkdir(parents=True, exist_ok=True)
            await cdp.command("Emulation.clearDeviceMetricsOverride")
            await cdp.command("Page.navigate", {"url": SITE_ORIGIN + route})
            await cdp.wait_for("document.readyState === 'complete'")
            await cdp.wait_for("location.hostname === 'fatcatfablab.org' && !/Just a moment/i.test(document.title)")
            await asyncio.sleep(1.5)

            metadata = json.loads(
                await cdp.evaluate(
                    """JSON.stringify({
                        title: document.title,
                        path: location.pathname,
                        description: document.querySelector('meta[name=description]')?.content || '',
                        canonical: document.querySelector('link[rel=canonical]')?.href || '',
                        og: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')]
                            .map(element => [element.getAttribute('property'), element.content])),
                        links: [...document.querySelectorAll('a[href]')].map(element => ({
                            text: element.innerText.trim(),
                            href: element.href
                        })),
                        images: [...document.querySelectorAll('img')].map(element => ({
                            src: element.currentSrc || element.src,
                            source: element.src,
                            srcset: element.srcset,
                            alt: element.alt,
                            width: element.naturalWidth,
                            height: element.naturalHeight
                        })),
                        stylesheets: [...document.querySelectorAll('link[rel=stylesheet]')].map(element => element.href),
                        scripts: [...document.querySelectorAll('script[src]')].map(element => element.src),
                        bodyText: document.body.innerText
                    })"""
                )
            )
            (page_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n")

            rendered_html = await cdp.evaluate("document.documentElement.outerHTML")
            (page_dir / "rendered.html").write_text(rendered_html)

            json_result = json.loads(
                await cdp.evaluate(
                    "fetch(location.pathname + '?format=json', {credentials: 'include'})"
                    ".then(async response => JSON.stringify({status: response.status, text: await response.text()}))",
                    await_promise=True,
                )
            )
            (page_dir / "response-status.txt").write_text(str(json_result["status"]) + "\n")
            (page_dir / "squarespace.json").write_text(json_result["text"])

            await capture_screenshot(cdp, page_dir / "desktop.png", 1440, 1000, False)
            await capture_screenshot(cdp, page_dir / "mobile.png", 390, 844, True)
            print(f"[{index:02d}/{len(routes):02d}] {route}")

        await cdp.command("Emulation.clearDeviceMetricsOverride")
        print(f"Captured {len(routes)} public routes under {OUTPUT.resolve()}")


if __name__ == "__main__":
    asyncio.run(main())
