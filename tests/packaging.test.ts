import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../src/lib/protected-auth";

const root = resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];
const syntheticHash = ["scrypt", "16384", "8", "1", "A".repeat(22), "B".repeat(43)].join("$");

const makeTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "fcfl-packaging-"));
  temporaryDirectories.push(directory);
  return directory;
};

const syntheticPage = (slug: "member-portal" | "membership2") => ({
  slug,
  path: `/${slug}`,
  title: slug,
  navigationTitle: slug,
  descriptionHtml: "",
  contentHtml: `<p>${slug}</p>`,
  homepage: false,
  type: "page",
  backgroundSource: null,
  mainImage: null,
  video: null,
  seo: { description: "Synthetic fixture", canonical: null, noindex: true },
  indexSections: [],
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Compose secret handling", () => {
  it("preserves a complete 83-character scrypt hash byte-for-byte when rendering config", async () => {
    expect(syntheticHash).toHaveLength(83);
    const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
    if (docker.status !== 0) return;

    const directory = await makeTemporaryDirectory();
    await writeFile(join(directory, ".env.deployment"), `FCFL_PROTECTED_PASSWORD_HASH=${syntheticHash}\nFCFL_SESSION_SECRET=${"S".repeat(48)}\n`);
    await writeFile(join(directory, "compose.yaml"), await readFile(join(root, "compose.yaml"), "utf8"));
    const rendered = spawnSync(
      "docker",
      ["compose", "--project-directory", directory, "-f", join(directory, "compose.yaml"), "config", "--format", "json"],
      { encoding: "utf8" },
    );

    expect(rendered.status, rendered.stderr).toBe(0);
    const config = JSON.parse(rendered.stdout) as { services: { web: { environment: Record<string, string> } } };
    const renderedHash = config.services.web.environment.FCFL_PROTECTED_PASSWORD_HASH;
    expect(renderedHash).toBe(syntheticHash.split("$").join("$$"));
    expect(renderedHash.split("$$").join("$")).toBe(syntheticHash);
  });
});

describe("container hardening contract", () => {
  it("pins Node by digest, enforces npm, prunes development packages, and uses a port-aware liveness check", async () => {
    const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64}/m);
    expect(dockerfile).toContain('test "$(npm --version)" = "10.9.8"');
    expect(dockerfile).toMatch(/FROM dependencies AS build\s+COPY astro\.config\.mjs tsconfig\.json/);
    expect(dockerfile).toMatch(/npm (?:ci --omit=dev|prune --omit=dev)/);
    expect(dockerfile).toContain("process.env.PORT");
    expect(dockerfile).toMatch(/USER\s+10001(?::10001)?/);
  });

  it("uses a raw required env file, read-only root filesystem, fixed non-root identity, tmpfs, and bounded shutdown", async () => {
    const compose = await readFile(join(root, "compose.yaml"), "utf8");
    expect(compose).toMatch(/env_file:\s*\n\s*- path: \.env\.deployment\s*\n\s*required: true\s*\n\s*format: raw/);
    expect(compose).toMatch(/read_only:\s*true/);
    expect(compose).toMatch(/user:\s*["']10001:10001["']/);
    expect(compose).toMatch(/tmpfs:/);
    expect(compose).toMatch(/stop_grace_period:/);
    expect(compose).toContain("process.env.PORT");
  });

  it("targets Node 22 types and declares the exact npm package manager", async () => {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      packageManager?: string;
      devEngines?: { packageManager?: { name?: string; version?: string; onFail?: string } };
      devDependencies?: Record<string, string>;
    };
    expect(manifest.packageManager).toBe("npm@10.9.8");
    expect(manifest.devEngines?.packageManager).toEqual({ name: "npm", version: "10.9.8", onFail: "error" });
    expect(manifest.devDependencies?.["@types/node"]).toMatch(/^\^22\./);
  });
});

describe("deployment safety tooling", () => {
  it("generates valid secrets into a mode-0600 env file without printing their values", async () => {
    const directory = await makeTemporaryDirectory();
    const envPath = join(directory, ".env");
    await writeFile(envPath, "FCFL_PROTECTED_PASSWORD_HASH=\nFCFL_SESSION_SECRET=\nFCFL_PRIVATE_CONTENT_PATH=/app/private-content/protected-pages.json\n");
    await chmod(envPath, 0o644);

    const generated = spawnSync(process.execPath, [join(root, "scripts/generate-deployment-secrets.mjs"), "--env-file", envPath], {
      encoding: "utf8",
      input: "synthetic-password-for-packaging-test",
    });
    expect(generated.status, generated.stderr).toBe(0);
    expect(generated.stdout).toBe("");

    const content = await readFile(envPath, "utf8");
    const passwordHash = content.match(/^FCFL_PROTECTED_PASSWORD_HASH=(.+)$/m)?.[1] ?? "";
    const sessionSecret = content.match(/^FCFL_SESSION_SECRET=(.+)$/m)?.[1] ?? "";
    expect(passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(verifyPassword("synthetic-password-for-packaging-test", passwordHash)).resolves.toBe(true);
    expect(Buffer.byteLength(sessionSecret, "utf8")).toBeGreaterThanOrEqual(32);
    expect((await stat(envPath)).mode & 0o777).toBe(0o600);
    expect(generated.stderr).not.toContain(passwordHash);
    expect(generated.stderr).not.toContain(sessionSecret);
  });

  it("validates auth and private mount shape without disclosing values", async () => {
    const directory = await makeTemporaryDirectory();
    const privatePath = join(directory, "protected-pages.json");
    await writeFile(privatePath, JSON.stringify([syntheticPage("member-portal"), syntheticPage("membership2")]));

    const checked = spawnSync(process.execPath, [join(root, "scripts/check-readiness.mjs")], {
      encoding: "utf8",
      env: {
        ...process.env,
        FCFL_PROTECTED_PASSWORD_HASH: syntheticHash,
        FCFL_SESSION_SECRET: "synthetic-session-secret-that-is-at-least-32-bytes",
        FCFL_PRIVATE_CONTENT_PATH: privatePath,
      },
    });
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toBe("readiness: ok\n");
    expect(checked.stdout + checked.stderr).not.toContain(syntheticHash);
    expect(checked.stdout + checked.stderr).not.toContain("synthetic-session-secret");
  });

  it("rejects malformed nested private content rather than faking readiness", async () => {
    const directory = await makeTemporaryDirectory();
    const privatePath = join(directory, "protected-pages.json");
    const malformed = syntheticPage("member-portal");
    malformed.indexSections.push({} as never);
    await writeFile(privatePath, JSON.stringify([malformed, syntheticPage("membership2")]));

    const checked = spawnSync(process.execPath, [join(root, "scripts/check-readiness.mjs")], {
      encoding: "utf8",
      env: {
        ...process.env,
        FCFL_PROTECTED_PASSWORD_HASH: syntheticHash,
        FCFL_SESSION_SECRET: "synthetic-session-secret-that-is-at-least-32-bytes",
        FCFL_PRIVATE_CONTENT_PATH: privatePath,
      },
    });
    expect(checked.status).not.toBe(0);
    expect(checked.stderr).toContain("FCFL_PRIVATE_CONTENT_PATH");
  });

  it("fails closed with field names but no secret values", async () => {
    const directory = await makeTemporaryDirectory();
    const missingPath = join(directory, "missing.json");
    const weakSecret = "too-short";
    const checked = spawnSync(process.execPath, [join(root, "scripts/check-readiness.mjs")], {
      encoding: "utf8",
      env: {
        ...process.env,
        FCFL_PROTECTED_PASSWORD_HASH: "invalid-hash",
        FCFL_SESSION_SECRET: weakSecret,
        FCFL_PRIVATE_CONTENT_PATH: missingPath,
      },
    });
    expect(checked.status).not.toBe(0);
    expect(checked.stderr).toContain("FCFL_PROTECTED_PASSWORD_HASH");
    expect(checked.stderr).toContain("FCFL_SESSION_SECRET");
    expect(checked.stderr).toContain("FCFL_PRIVATE_CONTENT_PATH");
    expect(checked.stderr).not.toContain(weakSecret);
    expect(checked.stderr).not.toContain("invalid-hash");
  });
});
