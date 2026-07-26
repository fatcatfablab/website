#!/usr/bin/env python3
"""Read-only Squarespace page inventory through the dedicated Brave CDP profile.

The script opens each page's settings panel and records metadata. It never saves
changes and deliberately excludes password field values and browser credentials.
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import urllib.request

import websockets

CDP_LIST = "http://127.0.0.1:9223/json/list"
ADMIN_URL_FRAGMENT = "fatcatfablab.squarespace.com/config/pages"
OUTPUT = pathlib.Path("research/admin-page-inventory.json")


class CDP:
    def __init__(self, websocket_url: str):
        self.websocket_url = websocket_url
        self.ws = None
        self.sequence = 0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.websocket_url, max_size=50_000_000)
        return self

    async def __aexit__(self, *_):
        await self.ws.close()

    async def command(self, method: str, params: dict | None = None, timeout: float = 30):
        self.sequence += 1
        command_id = self.sequence
        await self.ws.send(json.dumps({"id": command_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(await asyncio.wait_for(self.ws.recv(), timeout))
            if message.get("id") == command_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})

    async def evaluate(self, expression: str):
        result = await self.command(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )
        return result.get("result", {}).get("value")

    async def click_expression(self, element_expression: str):
        point = await self.evaluate(
            f"""(() => {{
                const element = {element_expression};
                if (!element) return null;
                element.scrollIntoView({{block: 'center', inline: 'nearest'}});
                const rect = element.getBoundingClientRect();
                return {{x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}};
            }})()"""
        )
        if not point:
            raise RuntimeError(f"Element not found: {element_expression}")
        for event_type in ("mousePressed", "mouseReleased"):
            await self.command(
                "Input.dispatchMouseEvent",
                {
                    "type": event_type,
                    "x": point["x"],
                    "y": point["y"],
                    "button": "left",
                    "clickCount": 1,
                },
            )

    async def wait_for(self, expression: str, timeout: float = 10):
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            if await self.evaluate(f"Boolean({expression})"):
                return
            await asyncio.sleep(0.15)
        raise TimeoutError(expression)


def find_admin_target():
    targets = json.load(urllib.request.urlopen(CDP_LIST, timeout=5))
    for target in targets:
        if target.get("type") == "page" and ADMIN_URL_FRAGMENT in target.get("url", ""):
            return target
    raise RuntimeError("Squarespace Pages panel is not open in the dedicated Brave profile")


async def main():
    target = find_admin_target()
    async with CDP(target["webSocketDebuggerUrl"]) as cdp:
        # Close a leftover settings panel from prior inspection.
        if await cdp.evaluate("Boolean(document.querySelector('[data-test=nav-modal-close-button]'))"):
            await cdp.click_expression("document.querySelector('[data-test=nav-modal-close-button]')")
            await cdp.wait_for("!document.querySelector('[data-test=nav-modal-close-button]')")

        rows = json.loads(
            await cdp.evaluate(
                """JSON.stringify([...document.querySelectorAll('[data-collection-id]')]
                    .filter(element => element.querySelector('[data-test=navlist-item] .title'))
                    .map((element, index) => ({
                        index,
                        collectionId: element.getAttribute('data-collection-id'),
                        title: element.querySelector('[data-test=navlist-item] .title').innerText.trim(),
                        group: element.closest('[role=navigation]')?.querySelector('h1')?.innerText.trim() || '',
                        iconClasses: [...element.querySelectorAll('[data-test=navlist-item] > .icon')]
                            .map(icon => icon.className),
                        hasSettings: Boolean(element.querySelector('.icon-configure'))
                    })))"""
            )
        )

        # Squarespace can render duplicate collection nodes. Keep the first DOM-order occurrence.
        unique_rows = []
        seen = set()
        for row in rows:
            collection_id = row["collectionId"]
            if not collection_id or collection_id in seen:
                continue
            seen.add(collection_id)
            unique_rows.append(row)

        inventory = []
        total = len(unique_rows)
        for position, row in enumerate(unique_rows, start=1):
            item = dict(row)
            item["settings"] = {}
            if not row["hasSettings"]:
                inventory.append(item)
                continue

            collection_id = json.dumps(row["collectionId"])
            selector = (
                f"document.querySelector('[data-collection-id=' + CSS.escape({collection_id}) + '] .icon-configure')"
            )
            try:
                await cdp.click_expression(selector)
                await cdp.wait_for(
                    "document.querySelector('[data-test=nav-modal-close-button]') "
                    "&& document.querySelector('input[aria-label=\"URL Slug\"]')"
                )

                general = json.loads(
                    await cdp.evaluate(
                        """JSON.stringify({
                            pageTitle: document.querySelector('input[aria-label="Page Title"]')?.value || '',
                            navigationTitle: document.querySelector('input[aria-label="Navigation Title"]')?.value || '',
                            urlSlug: document.querySelector('input[aria-label="URL Slug"]')?.value || '',
                            description: [...document.querySelectorAll('textarea')]
                                .find(element => element.getAttribute('aria-label') === 'Page Description')?.value || '',
                            visibilityToggles: [...document.querySelectorAll('input[type=checkbox]')]
                                .map(element => ({
                                    aria: element.getAttribute('aria-label'),
                                    checked: element.checked,
                                    value: element.value
                                }))
                        })"""
                    )
                )
                item["settings"]["general"] = general

                close_exists = await cdp.evaluate(
                    "Boolean(document.querySelector('[data-test=nav-modal-close-button]'))"
                )
                if close_exists:
                    await cdp.click_expression("document.querySelector('[data-test=nav-modal-close-button]')")
                    await cdp.wait_for("!document.querySelector('[data-test=nav-modal-close-button]')")
            except Exception as exc:
                item["error"] = f"{type(exc).__name__}: {exc}"
                if await cdp.evaluate("Boolean(document.querySelector('[data-test=nav-modal-close-button]'))"):
                    await cdp.click_expression("document.querySelector('[data-test=nav-modal-close-button]')")
                    try:
                        await cdp.wait_for("!document.querySelector('[data-test=nav-modal-close-button]')")
                    except Exception:
                        pass

            inventory.append(item)
            print(f"[{position:02d}/{total:02d}] {row['group']} / {row['title']}")

        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(inventory, indent=2, ensure_ascii=False) + "\n")
        print(f"Saved {len(inventory)} records to {OUTPUT.resolve()}")


if __name__ == "__main__":
    asyncio.run(main())
