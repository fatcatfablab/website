#!/usr/bin/env python3
"""Capture live layout metrics for representative public routes."""

import asyncio
import json
import pathlib
import urllib.request

import websockets

ROUTES = ["/", "/about", "/equipment-list", "/classes-events", "/membership", "/calendar", "/guest-pass"]


async def main():
    targets = json.load(urllib.request.urlopen("http://127.0.0.1:9223/json/list"))
    target = next(
        item
        for item in targets
        if item.get("type") == "page" and item.get("url", "").startswith("https://fatcatfablab.org/")
    )
    output = []
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=50_000_000) as socket:
        sequence = 0

        async def command(method, params=None, timeout=45):
            nonlocal sequence
            sequence += 1
            command_id = sequence
            await socket.send(json.dumps({"id": command_id, "method": method, "params": params or {}}))
            while True:
                message = json.loads(await asyncio.wait_for(socket.recv(), timeout))
                if message.get("id") == command_id:
                    return message.get("result", {})

        async def evaluate(expression):
            result = await command(
                "Runtime.evaluate", {"expression": expression, "returnByValue": True}
            )
            return result.get("result", {}).get("value")

        for width, height, mobile in [(1440, 1000, False), (390, 844, True)]:
            await command(
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
            for route in ROUTES:
                await command("Page.navigate", {"url": "https://fatcatfablab.org" + route})
                for _ in range(100):
                    if await evaluate("document.readyState === 'complete'"):
                        break
                    await asyncio.sleep(0.1)
                await asyncio.sleep(0.8)
                expression = """JSON.stringify((() => {
                  const q = selector => document.querySelector(selector);
                  const info = selector => {
                    const element = q(selector);
                    if (!element) return null;
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return {
                      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                      fontFamily: style.fontFamily, fontSize: style.fontSize,
                      fontWeight: style.fontWeight, color: style.color,
                      background: style.backgroundColor, display: style.display,
                      position: style.position
                    };
                  };
                  return {
                    route: location.pathname,
                    viewport: {width: innerWidth, height: innerHeight},
                    body: {scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight},
                    header: info('#header'), logo: info('#logoImage img'),
                    nav: info('#mainNavWrapper'), toggle: info('.mobile-nav-toggle'),
                    banner: info('.banner-thumbnail-wrapper'), content: info('#content'),
                    footer: info('#footer'), h1: info('h1'), p: info('p')
                  };
                })())"""
                output.append(json.loads(await evaluate(expression)))

        await command("Emulation.clearDeviceMetricsOverride")

    path = pathlib.Path("research/layout-metrics.json")
    path.write_text(json.dumps(output, indent=2))
    print(path.resolve(), len(output))


if __name__ == "__main__":
    asyncio.run(main())
