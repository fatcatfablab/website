import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPasswordHash, createSessionToken } from "../src/lib/protected-auth";
import { readProtectedForm } from "../src/pages/api/protected-login";

const root = resolve(import.meta.dirname, "..");
const syntheticPassword = "synthetic-route-test-password";
const syntheticSecret = "synthetic-route-session-secret-that-is-longer-than-32-bytes";
const memberSentinel = "SYNTHETIC_MEMBER_PRIVATE_PHRASE_7f6416";
const joinSentinel = "SYNTHETIC_JOIN_PRIVATE_PHRASE_a3bd91";

let tempRoot = "";
let privatePath = "";
let passwordHashPath = "";
let validOrigin = "";
let validServer: ChildProcess | undefined;
let authCookie = "";

const syntheticPage = (slug: "member-portal" | "membership2", title: string, contentHtml: string) => ({
  slug,
  path: `/${slug}`,
  title,
  navigationTitle: title,
  descriptionHtml: "",
  contentHtml,
  homepage: false,
  type: "page",
  backgroundSource: null,
  mainImage: null,
  video: null,
  seo: { description: "Synthetic protected route fixture", canonical: null, noindex: true },
  indexSections: [],
});

const reservePort = () =>
  new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Unable to reserve test port"));
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });

const waitForServer = async (origin: string, child: ChildProcess, serverOutput: () => string) => {
  const deadline = Date.now() + 20_000;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Astro test server exited before becoming ready:\n${serverOutput()}`);
    }
    try {
      const response = await fetch(`${origin}/member-portal`, { signal: AbortSignal.timeout(1_000) });
      const html = await response.text();
      lastFailure = `HTTP ${response.status}; password marker ${/password required/i.test(html)}`;
      if (/password required/i.test(html)) return;
    } catch (error) {
      lastFailure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      // Retry only while the dedicated child is starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for Astro test server (${lastFailure}):\n${serverOutput()}`);
};

const startServer = async (env: NodeJS.ProcessEnv) => {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    ASTRO_DEV_BACKGROUND: "0",
    NODE_ENV: "development",
    FCFL_TEST_PORT: String(port),
  };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("VITEST")) delete childEnv[key];
  }
  const program = `
    import { dev } from "astro";
    const requestedPort = Number(process.env.FCFL_TEST_PORT);
    const server = await dev({
      root: process.cwd(),
      server: { host: "127.0.0.1", port: requestedPort },
      devToolbar: { enabled: false },
      vite: { server: { strictPort: true } },
    });
    if (server.address.port !== requestedPort) {
      await server.stop();
      throw new Error("Astro fell back from the reserved protected-route test port");
    }
    const stop = async () => { await server.stop(); process.exit(0); };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    await new Promise(() => {});
  `;
  let output = "";
  const child = spawn(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: root,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk) => (output += chunk.toString()));
  try {
    await waitForServer(origin, child, () => output);
  } catch (error) {
    await stopServer(child);
    throw error;
  }
  return { child, origin };
};

const stopServer = async (child: ChildProcess | undefined) => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveStop();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
};

const postLogin = (origin: string, password: string, ip: string, returnTo = "/member-portal") =>
  fetch(`${origin}/api/protected-login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Forwarded-For": ip,
    },
    body: new URLSearchParams({ password, returnTo }),
  });

const postChunkedLogin = (origin: string, body: string, contentType = "application/x-www-form-urlencoded") =>
  new Promise<{ status: number; headers: Headers; body: string }>((resolveResponse, reject) => {
    const request = httpRequest(
      `${origin}/api/protected-login`,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": contentType,
          "X-Forwarded-For": "198.51.100.52",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
            else if (value !== undefined) headers.set(name, value);
          }
          resolveResponse({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.once("error", reject);
    const midpoint = Math.floor(body.length / 2);
    request.write(body.slice(0, midpoint));
    request.write(body.slice(midpoint));
    request.end();
  });

beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "fcfl-protected-routes-"));
  privatePath = join(tempRoot, "protected-pages.json");
  passwordHashPath = join(tempRoot, "password-hash");
  await mkdir(tempRoot, { recursive: true });
  await writeFile(
    privatePath,
    JSON.stringify([
      syntheticPage("member-portal", "Synthetic member portal", `<p>${memberSentinel}</p>`),
      syntheticPage("membership2", "Synthetic join page", `<p>${joinSentinel}</p>`),
    ]),
    { mode: 0o600 },
  );
  const passwordHash = await createPasswordHash(syntheticPassword, new Uint8Array(16).fill(19));
  await writeFile(passwordHashPath, passwordHash, { mode: 0o600 });

  const valid = await startServer({
    FCFL_SESSION_SECRET: syntheticSecret,
    FCFL_PROTECTED_PASSWORD_HASH: "",
    FCFL_PROTECTED_PASSWORD_HASH_FILE: passwordHashPath,
    FCFL_PRIVATE_CONTENT_PATH: privatePath,
    FCFL_TRUST_PROXY: "true",
  });
  validServer = valid.child;
  validOrigin = valid.origin;
}, 60_000);

afterAll(async () => {
  await stopServer(validServer);
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe.sequential("protected route HTTP contract", () => {
  it("serves an unauthenticated noindex login surface without private content", async () => {
    const response = await fetch(`${validOrigin}/member-portal`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/private.*no-store/i);
    expect(response.headers.get("x-robots-tag")).toMatch(/noindex.*nofollow/i);
    expect(html).toMatch(/password required/i);
    expect(html).toContain('name="returnTo" value="/member-portal"');
    expect(html).not.toContain(memberSentinel);
    expect(html).not.toContain(joinSentinel);
  });

  it("fails closed with a generic unavailable login surface when private configuration is missing", async () => {
    const unavailablePath = `${privatePath}.unavailable`;
    const token = createSessionToken(syntheticSecret, "protected-pages");
    await rename(privatePath, unavailablePath);
    let response: Response;
    try {
      response = await fetch(`${validOrigin}/membership2`, {
        headers: { Cookie: `fcfl_member=${token}` },
      });
    } finally {
      await rename(unavailablePath, privatePath);
    }
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toMatch(/temporarily unavailable/i);
    expect(html).not.toContain('action="/api/protected-login"');
    expect(html).not.toMatch(/FCFL_|session secret|private-content/i);
    expect(html).not.toContain(joinSentinel);
  });

  it("does not authorize a validly signed token when password configuration is unavailable", async () => {
    const token = createSessionToken(syntheticSecret, "protected-pages");
    const unavailablePath = `${passwordHashPath}.unavailable`;
    await rename(passwordHashPath, unavailablePath);
    let response: Response;
    try {
      response = await fetch(`${validOrigin}/member-portal`, {
        headers: { Cookie: `fcfl_member=${token}` },
      });
    } finally {
      await rename(unavailablePath, passwordHashPath);
    }
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toMatch(/temporarily unavailable/i);
    expect(html).not.toContain('action="/api/protected-login"');
    expect(html).not.toContain(memberSentinel);
    expect(html).not.toContain(joinSentinel);
  });

  it("rejects cross-origin and bad-password submissions generically with no-store headers", async () => {
    const crossOrigin = await fetch(`${validOrigin}/api/protected-login`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: "https://attacker.invalid", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: syntheticPassword, returnTo: "/member-portal" }),
    });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.text()).toMatch(/(?:unable to sign in|forbidden)/i);

    const badPassword = await postLogin(validOrigin, "incorrect-synthetic-password", "198.51.100.31");
    expect(badPassword.status).toBe(303);
    expect(badPassword.headers.get("location")).toBe("/member-portal?loginError=1");
    expect(badPassword.headers.get("cache-control")).toContain("no-store");
    expect(badPassword.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("rejects oversized chunked forms before parsing and rejects the wrong media type", async () => {
    const oversized = await postChunkedLogin(validOrigin, `password=${"x".repeat(5_000)}`);
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get("cache-control")).toContain("no-store");
    expect(oversized.body).toMatch(/unable to sign in/i);
    expect(oversized.body).not.toContain(memberSentinel);
    expect(oversized.body).not.toContain(joinSentinel);

    const wrongType = await postChunkedLogin(validOrigin, "password=anything", "text/plain");
    expect(wrongType.status).toBe(415);
    expect(wrongType.headers.get("cache-control")).toContain("no-store");
  });

  it("preserves the 413 result when cancelling an oversized request stream fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4_097));
      },
      cancel() {
        throw new Error("synthetic cancellation failure");
      },
    });
    const request = new Request(`${validOrigin}/api/protected-login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readProtectedForm(request)).rejects.toMatchObject({ status: 413 });
  });

  it("accepts an exactly 4096-byte URL-encoded form", async () => {
    const prefix = "password=incorrect&returnTo=%2Fmember-portal&padding=";
    const body = `${prefix}${"x".repeat(4_096 - Buffer.byteLength(prefix))}`;
    expect(Buffer.byteLength(body)).toBe(4_096);

    const response = await postChunkedLogin(validOrigin, body);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/member-portal?loginError=1");
  });

  it("rate limits by the configured client hop before accepting more password attempts", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await postLogin(validOrigin, "incorrect-synthetic-password", "198.51.100.44")).status);
    }
    expect(statuses.slice(0, 5)).toEqual([303, 303, 303, 303, 303]);
    expect(statuses[5]).toBe(429);

    const limited = await postLogin(validOrigin, syntheticPassword, "198.51.100.44");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("sets the bounded host-only session cookie and allowlists the redirect", async () => {
    const response = await postLogin(validOrigin, syntheticPassword, "198.51.100.45", "https://attacker.invalid/steal");
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/member-portal");
    expect(setCookie).toMatch(/^fcfl_member=/);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).not.toMatch(/;\s*Secure(?:;|$)/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Max-Age=28800/i);
    expect(setCookie).not.toMatch(/Domain=/i);
    authCookie = setCookie.split(";", 1)[0];
  });

  it("renders private content only with a valid authenticated cookie", async () => {
    const response = await fetch(`${validOrigin}/member-portal`, { headers: { Cookie: authCookie } });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/private.*no-store/i);
    expect(response.headers.get("x-robots-tag")).toMatch(/noindex.*nofollow/i);
    expect(html).toContain(memberSentinel);
    expect(html).not.toContain(joinSentinel);
  });

  it("logs out through same-origin POST and expires the host-only cookie", async () => {
    const response = await fetch(`${validOrigin}/api/protected-logout`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: validOrigin, Cookie: authCookie },
    });
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/member-portal");
    expect(setCookie).toMatch(/^fcfl_member=/);
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).not.toMatch(/;\s*Secure(?:;|$)/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  it("does not copy synthetic private content or protected JSON into source, public, or dist", async () => {
    const roots = ["src/data", "public", "dist/client"].map((path) => resolve(root, path));
    const files: string[] = [];
    const visit = async (path: string) => {
      let entries;
      try {
        entries = await readdir(path, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile() || entry.isSymbolicLink()) files.push(child);
        else throw new Error(`Unsupported public artifact type: ${child}`);
      }
    };
    for (const rootPath of roots) await visit(rootPath);

    for (const file of files) {
      expect(file).not.toMatch(/protected-pages\.json$/);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let nextFile = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(8, files.length) }, async () => {
          while (nextFile < files.length) {
            const file = files[nextFile++];
            const content = await readFile(file, { signal: controller.signal });
            expect(content.includes(Buffer.from(memberSentinel)), file).toBe(false);
            expect(content.includes(Buffer.from(joinSentinel)), file).toBe(false);
          }
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  }, 20_000);
});
