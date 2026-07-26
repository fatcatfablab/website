import node from "@astrojs/node";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // The captured Squarespace LESS output includes browser-ignored selector
  // artifacts that Lightning CSS rejects while minifying. Preserve it raw.
  vite: {
    build: {
      cssMinify: false,
    },
  },
});

    // browsers and PostCSS tolerate but Lightning CSS rejects while minifying.
    // Keep the source byte-compatible and serve unminified CSS instead of
    // mutating historical rules during migration.
    build: { cssMinify: false },
  },
});
