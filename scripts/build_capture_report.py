#!/usr/bin/env python3
"""Summarize the migration capture without copying private page bodies or browser credentials."""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import urllib.parse

from bs4 import BeautifulSoup

ROOT = pathlib.Path("research")
ADMIN_MANIFEST = ROOT / "admin-pages" / "manifest.json"
ADMIN_INVENTORY = ROOT / "admin-page-inventory.json"
PUBLIC_ROOT = ROOT / "pages"
OUTPUT = ROOT / "capture-report.json"


def public_metadata(slug: str):
    html_path = PUBLIC_ROOT / slug / "rendered.html"
    if not html_path.exists():
        return None
    source = html_path.read_text(errors="ignore")
    soup = BeautifulSoup(source, "html.parser")
    meta = {}
    for node in soup.select("meta[name], meta[property]"):
        key = node.get("name") or node.get("property")
        value = node.get("content")
        if key and value and key.lower() in {
            "description",
            "robots",
            "og:title",
            "og:description",
            "og:image",
            "og:url",
            "twitter:title",
            "twitter:description",
            "twitter:image",
        }:
            meta[key.lower()] = value
    canonical = soup.select_one('link[rel="canonical"]')
    links = []
    for node in soup.select("a[href], iframe[src], script[src]"):
        value = node.get("href") or node.get("src")
        if not value:
            continue
        parsed = urllib.parse.urlparse(value if "://" in value else "https://fatcatfablab.org" + value)
        if parsed.hostname:
            links.append(parsed.hostname)
    analytics = sorted(set(re.findall(r"(?:UA-\d+-\d+|G-[A-Z0-9]+)", source)))
    return {
        "documentTitle": soup.title.get_text(strip=True) if soup.title else None,
        "canonical": canonical.get("href") if canonical else None,
        "meta": meta,
        "externalHosts": sorted(
            host
            for host in set(links)
            if not host.endswith(("fatcatfablab.org", "squarespace.com", "squarespace-cdn.com"))
        ),
        "analyticsIds": analytics,
        "iframeCount": len(soup.select("iframe[src]")),
    }


def main():
    manifest = json.loads(ADMIN_MANIFEST.read_text())
    inventory = {row["collectionId"]: row for row in json.loads(ADMIN_INVENTORY.read_text())}
    pages = []
    for record in manifest:
        row = inventory[record["collectionId"]]
        path = ROOT / "admin-pages" / record["slug"] / "squarespace.json"
        raw = path.read_text()
        try:
            data = json.loads(raw)
            content_kind = "json"
        except json.JSONDecodeError:
            data = {"collection": {}}
            content_kind = "html"
        collection = data.get("collection", {})
        pages.append(
            {
                "collectionId": record["collectionId"],
                "group": record.get("group"),
                "title": collection.get("title") or record["title"],
                "navigationTitle": collection.get("navigationTitle"),
                "slug": record["slug"],
                "route": record["route"],
                "enabled": collection.get("enabled"),
                "folder": collection.get("folder"),
                "homepage": collection.get("homepage"),
                "passwordProtected": collection.get("passwordProtected"),
                "typeName": collection.get("typeName"),
                "captureStatus": record.get("status"),
                "captureKind": content_kind,
                "public": public_metadata(record["slug"]),
            }
        )

    home = json.loads((ROOT / "admin-pages" / "home" / "squarespace.json").read_text())
    website = home["website"]
    settings = home["websiteSettings"]
    assets = json.loads((ROOT / "assets" / "manifest.json").read_text())
    report = {
        "capturedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "site": {
            "id": website.get("id"),
            "title": website.get("siteTitle"),
            "fullTitle": website.get("fullSiteTitle"),
            "primaryDomain": website.get("primaryDomain"),
            "internalUrl": website.get("internalUrl"),
            "language": website.get("language"),
            "timeZone": website.get("timeZone"),
            "location": website.get("location"),
            "socialAccounts": [
                {
                    "serviceName": account.get("serviceName"),
                    "profileUrl": account.get("profileUrl"),
                    "iconEnabled": account.get("iconEnabled"),
                }
                for account in website.get("socialAccounts", [])
            ],
            "announcementBar": settings.get("announcementBarSettings"),
            "template": {
                "family": "Bedford",
                "variant": "Anya & Deven",
                "version": "7.0",
            },
        },
        "urlMappings": [],
        "pages": pages,
        "assets": {
            "archived": len(assets.get("assets", [])),
            "failures": len(assets.get("failures", [])),
        },
    }
    OUTPUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(
        f"{len(pages)} pages; {sum(bool(p['enabled']) for p in pages)} enabled; "
        f"{sum(bool(p['passwordProtected']) for p in pages)} protected; "
        f"{report['assets']['archived']} assets; {report['assets']['failures']} failures"
    )


if __name__ == "__main__":
    main()
