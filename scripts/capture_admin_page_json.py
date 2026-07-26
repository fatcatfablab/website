#!/usr/bin/env python3
"""Archive Squarespace JSON for enabled, unlinked, disabled, and protected pages.

Runs inside the authenticated Squarespace admin origin. Password values and
browser credentials are never read or written.
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import urllib.request

import websockets

CDP_LIST = "http://127.0.0.1:9223/json/list"
ADMIN_URL_FRAGMENT = "fatcatfablab.squarespace.com/config/"
INVENTORY = pathlib.Path("research/admin-page-inventory.json")
OUTPUT = pathlib.Path("research/admin-pages")
FALLBACK_SLUGS = {
    "56b944cfb09f955797c1e7df": "equipment-list-1",
    "56b944f89f72664730f675f8": "laser-cutter",
    "628e62eb01e396422dc157f5": "archive",
    "642fef35bdfdb2788be9864f": "member-portal-legacy",
}


async def main():
    targets = json.load(urllib.request.urlopen(CDP_LIST, timeout=5))
    target = next(
        target
        for target in targets
        if target.get("type") == "page" and ADMIN_URL_FRAGMENT in target.get("url", "")
    )
    rows = json.loads(INVENTORY.read_text())
    OUTPUT.mkdir(parents=True, exist_ok=True)

    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=100_000_000) as ws:
        sequence = 0

        async def evaluate(expression: str):
            nonlocal sequence
            sequence += 1
            command_id = sequence
            await ws.send(
                json.dumps(
                    {
                        "id": command_id,
                        "method": "Runtime.evaluate",
                        "params": {
                            "expression": expression,
                            "awaitPromise": True,
                            "returnByValue": True,
                        },
                    }
                )
            )
            while True:
                message = json.loads(await asyncio.wait_for(ws.recv(), 60))
                if message.get("id") == command_id:
                    if "error" in message:
                        raise RuntimeError(message["error"])
                    return message.get("result", {}).get("result", {}).get("value")

        manifest = []
        for index, row in enumerate(rows, start=1):
            general = row.get("settings", {}).get("general", {})
            slug = general.get("urlSlug") or FALLBACK_SLUGS.get(row["collectionId"])
            if not slug:
                manifest.append({**row, "captureStatus": "missing-slug"})
                continue

            route = "/" + slug.strip("/")
            expression = (
                f"fetch({json.dumps(route + '?format=json')}, {{credentials: 'include'}})"
                ".then(async response => JSON.stringify({"
                "status: response.status, contentType: response.headers.get('content-type'), text: await response.text()}))"
            )
            result = json.loads(await evaluate(expression))
            page_dir = OUTPUT / slug
            page_dir.mkdir(parents=True, exist_ok=True)
            (page_dir / "response-status.txt").write_text(str(result["status"]) + "\n")
            (page_dir / "squarespace.json").write_text(result["text"])
            manifest.append(
                {
                    "collectionId": row["collectionId"],
                    "title": row["title"],
                    "group": row.get("group", ""),
                    "slug": slug,
                    "route": route,
                    "status": result["status"],
                    "contentType": result["contentType"],
                }
            )
            print(f"[{index:02d}/{len(rows):02d}] {result['status']} {route}")

        (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        print(f"Saved {len(manifest)} records to {OUTPUT.resolve()}")


if __name__ == "__main__":
    asyncio.run(main())
