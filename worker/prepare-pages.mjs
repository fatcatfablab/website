import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("src/index.js", "dist/_worker.js");
await writeFile("dist/index.html", "<!doctype html><title>Maker Workshops API</title><p>Maker Workshops API</p>\n");
