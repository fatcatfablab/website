import { describe, expect, it } from "vitest";
import {
  consumeLoginAttempt,
  createPasswordHash,
  createSessionToken,
  getRequestClientAddress,
  hasSupportedPasswordHash,
  normalizeProtectedReturnTo,
  protectedCookieName,
  PROTECTED_COOKIE_NAME,
  verifyPassword,
  verifySessionToken,
} from "../src/lib/protected-auth";
import { readProtectedForm } from "../src/pages/api/protected-login";

const sessionSecret = "synthetic-session-secret-with-at-least-32-bytes";

describe("protected password verification", () => {
  it("uses a versioned scrypt hash and rejects incorrect or malformed values", async () => {
    const encoded = await createPasswordHash(
      "correct horse battery staple",
      new Uint8Array(16).fill(7),
    );

    expect(encoded).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hasSupportedPasswordHash(encoded)).toBe(true);
    expect(hasSupportedPasswordHash("scrypt$16384$8$1$a$a")).toBe(false);
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong", encoded)).resolves.toBe(false);
    await expect(
      verifyPassword("correct horse battery staple", encoded.replace("$16384$", "$016384$")),
    ).resolves.toBe(false);
    await expect(verifyPassword("correct horse battery staple", `${encoded}%`)).resolves.toBe(false);
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
  });
});

describe("protected session tokens", () => {
  it("accepts only an untampered, unexpired, correctly scoped token", () => {
    const token = createSessionToken(sessionSecret, "protected-pages", 1_000, 60);
    const [payload] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    expect(claims).toMatchObject({ v: 1, iat: 1_000, exp: 1_060, scope: "protected-pages" });
    expect(verifySessionToken(token, sessionSecret, "protected-pages", 1_059)).toBe(true);
    expect(verifySessionToken(token, sessionSecret, "protected-pages", 1_061)).toBe(false);
    expect(verifySessionToken(token, sessionSecret, "other-scope", 1_001)).toBe(false);
    expect(verifySessionToken(`${token}x`, sessionSecret, "protected-pages", 1_001)).toBe(false);
    expect(verifySessionToken(`${token}%`, sessionSecret, "protected-pages", 1_001)).toBe(false);
    expect(verifySessionToken(token, "different-session-secret-with-32-bytes", "protected-pages", 1_001)).toBe(false);
  });

  it("rejects weak secrets, future-issued tokens, and lifetimes beyond eight hours", () => {
    expect(() => createSessionToken("too-short", "protected-pages", 1_000, 60)).toThrow(/32 bytes/);
    expect(() => createSessionToken(sessionSecret, "protected-pages", 1_000, 28_801)).toThrow(/lifetime/i);

    const futureToken = createSessionToken(sessionSecret, "protected-pages", 2_000, 60);
    expect(verifySessionToken(futureToken, sessionSecret, "protected-pages", 1_000)).toBe(false);
  });
});

describe("protected login boundaries", () => {
  it("uses the production host-only cookie name and a local HTTP fallback", () => {
    expect(PROTECTED_COOKIE_NAME).toBe("__Host-fcfl_member");
    expect(protectedCookieName(true)).toBe("__Host-fcfl_member");
    expect(protectedCookieName(false)).toBe("fcfl_member");
  });

  it("enforces the form media type and byte limit even without Content-Length", async () => {
    const oversized = new Request("https://lab.example/api/protected-login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${"x".repeat(5_000)}`,
    });
    await expect(readProtectedForm(oversized)).rejects.toMatchObject({ status: 413 });

    const wrongType = new Request("https://lab.example/api/protected-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await expect(readProtectedForm(wrongType)).rejects.toMatchObject({ status: 415 });
  });

  it("allows only explicit local protected return paths", () => {
    expect(normalizeProtectedReturnTo("/member-portal")).toBe("/member-portal");
    expect(normalizeProtectedReturnTo("/membership2?step=payment")).toBe("/membership2?step=payment");
    expect(normalizeProtectedReturnTo("https://evil.example/steal")).toBe("/member-portal");
    expect(normalizeProtectedReturnTo("//evil.example/steal")).toBe("/member-portal");
    expect(normalizeProtectedReturnTo("/about")).toBe("/member-portal");
  });

  it("throttles before password verification, bounds state, and resets after the window", () => {
    const attempts = new Map();

    expect(consumeLoginAttempt(attempts, "203.0.113.9", 1_000, 2, 60, 3)).toEqual({ allowed: true, retryAfter: 0 });
    expect(consumeLoginAttempt(attempts, "203.0.113.9", 1_001, 2, 60, 3)).toEqual({ allowed: true, retryAfter: 0 });
    expect(consumeLoginAttempt(attempts, "203.0.113.9", 1_002, 2, 60, 3)).toEqual({ allowed: false, retryAfter: 58 });
    expect(consumeLoginAttempt(attempts, "203.0.113.9", 1_061, 2, 60, 3)).toEqual({ allowed: true, retryAfter: 0 });

    consumeLoginAttempt(attempts, "203.0.113.10", 1_062, 2, 60, 3);
    consumeLoginAttempt(attempts, "203.0.113.11", 1_063, 2, 60, 3);
    consumeLoginAttempt(attempts, "203.0.113.12", 1_064, 2, 60, 3);
    expect(attempts.size).toBeLessThanOrEqual(3);
  });

  it("trusts exactly the nearest valid forwarded hop only when configured", () => {
    const request = new Request("https://lab.example/api/protected-login", {
      headers: { "x-forwarded-for": "198.51.100.8, 203.0.113.4" },
    });

    expect(getRequestClientAddress(request, "192.0.2.10", false)).toBe("192.0.2.10");
    expect(getRequestClientAddress(request, "192.0.2.10", true)).toBe("203.0.113.4");
    expect(
      getRequestClientAddress(
        new Request("https://lab.example", { headers: { "x-forwarded-for": "not-an-ip" } }),
        "192.0.2.10",
        true,
      ),
    ).toBe("192.0.2.10");
  });
});
