#!/usr/bin/env python3
import json
import math
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "test-results/visual-parity")
REPORT_PATH = OUTPUT / "metrics.json"
PAIR_DIR = OUTPUT / "pairs"
SHEET_DIR = OUTPUT / "contact-sheets"
PAIR_DIR.mkdir(parents=True, exist_ok=True)
SHEET_DIR.mkdir(parents=True, exist_ok=True)

report = json.loads(REPORT_PATH.read_text())
font = ImageFont.load_default(size=22)
small_font = ImageFont.load_default(size=16)


def blank_white_runs(image: Image.Image):
    sample_width = 320
    ratio = sample_width / image.width
    sampled = image.resize((sample_width, max(1, round(image.height * ratio)))).convert("RGB")
    rows = []
    for y in range(sampled.height):
        pixels = [sampled.getpixel((x, y)) for x in range(8, sample_width - 8)]
        white = sum(1 for red, green, blue in pixels if red >= 247 and green >= 247 and blue >= 247)
        rows.append(white / len(pixels) >= 0.985)
    runs = []
    start = None
    for index, is_blank in enumerate(rows + [False]):
        if is_blank and start is None:
            start = index
        elif not is_blank and start is not None:
            runs.append((round(start / ratio), round(index / ratio)))
            start = None
    return sorted(runs, key=lambda value: value[1] - value[0], reverse=True)


def css_rgba(value):
    match = re.fullmatch(r"rgba?\(([^)]+)\)", value or "")
    if not match:
        return None
    parts = [float(piece.strip()) for piece in match.group(1).split(",")]
    if len(parts) == 3:
        parts.append(1.0)
    return tuple(parts)


def color_delta(left, right):
    left_rgba = css_rgba(left)
    right_rgba = css_rgba(right)
    if not left_rgba or not right_rgba:
        return None
    def composite(value):
        red, green, blue, alpha = value
        return tuple(channel * alpha + 255 * (1 - alpha) for channel in (red, green, blue))
    a = composite(left_rgba)
    b = composite(right_rgba)
    return round(math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b))), 2)


def match_text_metrics(original, clone):
    original_by_text = {item["text"]: item for item in original.get("firstText", []) if item.get("text")}
    matches = []
    for item in clone.get("firstText", []):
        source = original_by_text.get(item.get("text"))
        if not source:
            continue
        matches.append({
            "text": item["text"][:80],
            "xDelta": round(item["rect"]["x"] - source["rect"]["x"], 2),
            "yDelta": round(item["rect"]["y"] - source["rect"]["y"], 2),
            "widthDelta": round(item["rect"]["width"] - source["rect"]["width"], 2),
            "heightDelta": round(item["rect"]["height"] - source["rect"]["height"], 2),
            "fontSize": [source.get("fontSize"), item.get("fontSize")],
            "lineHeight": [source.get("lineHeight"), item.get("lineHeight")],
            "color": [source.get("color"), item.get("color")],
            "colorDelta": color_delta(source.get("color"), item.get("color")),
        })
    return matches


summary = []
pair_paths = []
for item in report["pages"]:
    route = item["route"]
    slug = route["slug"]
    original_path = OUTPUT / "original" / f"{slug}.png"
    clone_path = OUTPUT / "clone" / f"{slug}.png"
    original = Image.open(original_path).convert("RGB")
    clone = Image.open(clone_path).convert("RGB")
    if original.size != clone.size:
        raise RuntimeError(f"Viewport mismatch for {route['path']}: {original.size} vs {clone.size}")

    label_height = 54
    pair = Image.new("RGB", (original.width + clone.width, original.height + label_height), "#101418")
    draw = ImageDraw.Draw(pair)
    draw.text((20, 16), f"ORIGINAL · {route['path']}", fill="white", font=font)
    draw.text((original.width + 20, 16), f"CLONE · {route['path']}", fill="white", font=font)
    pair.paste(original, (0, label_height))
    pair.paste(clone, (original.width, label_height))
    pair_path = PAIR_DIR / f"{slug}.png"
    pair.save(pair_path, optimize=True)
    pair_paths.append(pair_path)

    original_runs = blank_white_runs(original)
    clone_runs = blank_white_runs(clone)
    original_metrics = item["original"]["metrics"]
    clone_metrics = item["clone"]["metrics"]
    text_matches = match_text_metrics(original_metrics, clone_metrics)
    summary.append({
        "path": route["path"],
        "slug": slug,
        "statuses": [item["original"].get("response", {}).get("status"), item["clone"].get("response", {}).get("status")],
        "challenge": item["original"]["metrics"].get("challenge"),
        "cloneTheme": clone_metrics.get("theme"),
        "horizontalOverflow": [original_metrics.get("horizontalOverflow"), clone_metrics.get("horizontalOverflow")],
        "bodyHeight": [original_metrics["scroll"]["height"], clone_metrics["scroll"]["height"]],
        "banner": [original_metrics.get("banner"), clone_metrics.get("banner")],
        "firstContent": [original_metrics.get("firstContent"), clone_metrics.get("firstContent")],
        "largestWhiteRun": [original_runs[0] if original_runs else None, clone_runs[0] if clone_runs else None],
        "visibleTextMatches": text_matches,
        "cloneErrors": item["clone"].get("errors", []),
        "pairScreenshot": str(pair_path.relative_to(ROOT)),
    })

for sheet_index in range(0, len(pair_paths), 4):
    selected = pair_paths[sheet_index:sheet_index + 4]
    thumbnails = []
    for path in selected:
        image = Image.open(path).convert("RGB")
        image.thumbnail((950, 320), Image.Resampling.LANCZOS)
        thumb = Image.new("RGB", (950, 320), "#d9dde0")
        thumb.paste(image, ((950 - image.width) // 2, 0))
        ImageDraw.Draw(thumb).text((10, 298), path.stem, fill="#111", font=small_font)
        thumbnails.append(thumb)
    sheet = Image.new("RGB", (1900, 640), "#d9dde0")
    for index, thumb in enumerate(thumbnails):
        sheet.paste(thumb, ((index % 2) * 950, (index // 2) * 320))
    sheet.save(SHEET_DIR / f"sheet-{sheet_index // 4 + 1:02d}.jpg", quality=92, optimize=True)

(OUTPUT / "comparison-summary.json").write_text(json.dumps(summary, indent=2) + "\n")

lines = [
    "# Original vs clone visual-parity report",
    "",
    f"Viewport: {report['viewport']['width']}×{report['viewport']['height']}; both screenshots start at scroll position 0.",
    "",
    "| Route | HTTP | Theme | Body height original / clone | Largest blank-white run original / clone | Matched visible text |",
    "|---|---:|---|---:|---:|---:|",
]
for item in summary:
    white = item["largestWhiteRun"]
    white_sizes = [value[1] - value[0] if value else 0 for value in white]
    lines.append(
        f"| `{item['path']}` | {item['statuses'][0]}/{item['statuses'][1]} | {item['cloneTheme']} | "
        f"{item['bodyHeight'][0]:.0f} / {item['bodyHeight'][1]:.0f} | {white_sizes[0]} / {white_sizes[1]} px | "
        f"{len(item['visibleTextMatches'])} |"
    )
(OUTPUT / "README.md").write_text("\n".join(lines) + "\n")

print(f"Built {len(pair_paths)} labeled side-by-side screenshots and {math.ceil(len(pair_paths) / 4)} contact sheets.")
print(OUTPUT / "comparison-summary.json")
