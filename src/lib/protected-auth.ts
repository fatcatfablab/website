import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const MAX_PASSWORD_BYTES = 1_024;
const MIN_SESSION_SECRET_BYTES = 32;
const MAX_SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const PROTECTED_PATHS = new Set(["/member-portal", "/membership2"]);

export const PROTECTED_SCOPE = "protected-pages";
export const PROTECTED_SESSION_SECONDS = MAX_SESSION_LIFETIME_SECONDS;
export const PROTECTED_COOKIE_NAME = "__Host-fcfl_member";
const LOCAL_PROTECTED_COOKIE_NAME = "fcfl_member";

export const protectedCookieSecure = () =>
  process.env.NODE_ENV === "production" || process.env.FCFL_COOKIE_SECURE === "true";

export const protectedCookieName = (secure = protectedCookieSecure()) =>
  secure ? PROTECTED_COOKIE_NAME : LOCAL_PROTECTED_COOKIE_NAME;

const readRuntimeSecret = (valueName: string, fileName: string) => {
  const direct = process.env[valueName];
  if (direct) return direct;
  const path = process.env[fileName];
  if (!path) return "";
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

export const readProtectedRuntimeConfig = () => ({
  passwordHash: readRuntimeSecret("FCFL_PROTECTED_PASSWORD_HASH", "FCFL_PROTECTED_PASSWORD_HASH_FILE"),
  sessionSecret: readRuntimeSecret("FCFL_SESSION_SECRET", "FCFL_SESSION_SECRET_FILE"),
});

export interface LoginAttemptState {
  count: number;
  resetAt: number;
}

export type LoginAttemptResult = { allowed: true; retryAfter: 0 } | { allowed: false; retryAfter: number };

const deriveScryptKey = (password: string, salt: Uint8Array) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });

const validPasswordLength = (password: string) =>
  password.length > 0 && Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES;

const decodeBase64Url = (value: string): Buffer | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
};

export async function createPasswordHash(password: string, salt: Uint8Array = randomBytes(16)): Promise<string> {
  if (!validPasswordLength(password)) throw new Error("Password length is invalid");
  if (salt.byteLength < 16) throw new Error("Password salt must be at least 16 bytes");

  const digest = await deriveScryptKey(password, salt);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    Buffer.from(salt).toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (!validPasswordLength(password)) return false;

  const [algorithm, n, r, p, encodedSalt, encodedDigest, extra] = encodedHash.split("$");
  if (
    extra !== undefined ||
    algorithm !== "scrypt" ||
    n !== String(SCRYPT_N) ||
    r !== String(SCRYPT_R) ||
    p !== String(SCRYPT_P) ||
    !encodedSalt ||
    !encodedDigest
  ) {
    return false;
  }

  try {
    const salt = decodeBase64Url(encodedSalt);
    const expected = decodeBase64Url(encodedDigest);
    if (!salt || !expected) return false;
    if (salt.byteLength < 16 || expected.byteLength !== SCRYPT_KEY_LENGTH) return false;
    const actual = await deriveScryptKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const requireSessionSecret = (secret: string) => {
  if (Buffer.byteLength(secret, "utf8") < MIN_SESSION_SECRET_BYTES) {
    throw new Error("Session secret must be at least 32 bytes");
  }
};

export const hasValidSessionSecret = (secret: string) =>
  Buffer.byteLength(secret, "utf8") >= MIN_SESSION_SECRET_BYTES;

export const hasSupportedPasswordHash = (encodedHash: string) => {
  const [algorithm, n, r, p, encodedSalt, encodedDigest, extra] = encodedHash.split("$");
  if (
    extra !== undefined ||
    algorithm !== "scrypt" ||
    n !== String(SCRYPT_N) ||
    r !== String(SCRYPT_R) ||
    p !== String(SCRYPT_P) ||
    !encodedSalt ||
    !encodedDigest
  ) {
    return false;
  }
  const salt = decodeBase64Url(encodedSalt);
  const digest = decodeBase64Url(encodedDigest);
  return salt !== null && salt.byteLength >= 16 && digest !== null && digest.byteLength === SCRYPT_KEY_LENGTH;
};

const signSessionPayload = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export function createSessionToken(
  secret: string,
  scope: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
  lifetimeSeconds = 8 * 60 * 60,
): string {
  requireSessionSecret(secret);
  if (!scope || lifetimeSeconds <= 0 || lifetimeSeconds > MAX_SESSION_LIFETIME_SECONDS) {
    throw new Error("Session scope and bounded lifetime are required");
  }

  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      iat: nowSeconds,
      exp: nowSeconds + lifetimeSeconds,
      scope,
      nonce: randomBytes(16).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${signSessionPayload(payload, secret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  expectedScope: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  if (!token || !expectedScope) return false;

  try {
    requireSessionSecret(secret);
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, suppliedSignature] = parts;
    const actualSignature = decodeBase64Url(suppliedSignature);
    const expectedSignature = Buffer.from(signSessionPayload(payload, secret), "base64url");
    if (!actualSignature) return false;
    if (actualSignature.byteLength !== expectedSignature.byteLength) return false;
    if (!timingSafeEqual(actualSignature, expectedSignature)) return false;

    const decodedPayload = decodeBase64Url(payload);
    if (!decodedPayload) return false;
    const parsed = JSON.parse(decodedPayload.toString("utf8")) as {
      v?: unknown;
      iat?: unknown;
      exp?: unknown;
      scope?: unknown;
      nonce?: unknown;
    };
    return (
      parsed.v === 1 &&
      typeof parsed.iat === "number" &&
      Number.isInteger(parsed.iat) &&
      typeof parsed.exp === "number" &&
      Number.isInteger(parsed.exp) &&
      parsed.iat <= nowSeconds &&
      parsed.exp > parsed.iat &&
      parsed.exp - parsed.iat <= MAX_SESSION_LIFETIME_SECONDS &&
      parsed.exp >= nowSeconds &&
      parsed.scope === expectedScope &&
      typeof parsed.nonce === "string" &&
      parsed.nonce.length >= 16
    );
  } catch {
    return false;
  }
}

export function normalizeProtectedReturnTo(value: string | null | undefined): string {
  if (!value) return "/member-portal";

  try {
    const url = new URL(value, "https://protected.local");
    if (url.origin !== "https://protected.local" || !PROTECTED_PATHS.has(url.pathname)) {
      return "/member-portal";
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return "/member-portal";
  }
}

export function consumeLoginAttempt(
  attempts: Map<string, LoginAttemptState>,
  key: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
  maxAttempts = 5,
  windowSeconds = 15 * 60,
  maxEntries = 2_000,
): LoginAttemptResult {
  for (const [entryKey, state] of attempts) {
    if (nowSeconds >= state.resetAt) attempts.delete(entryKey);
  }

  const existing = attempts.get(key);
  if (!existing || nowSeconds >= existing.resetAt) {
    if (attempts.size >= maxEntries) {
      let oldestKey: string | undefined;
      let oldestReset = Number.POSITIVE_INFINITY;
      for (const [entryKey, state] of attempts) {
        if (state.resetAt < oldestReset) {
          oldestKey = entryKey;
          oldestReset = state.resetAt;
        }
      }
      if (oldestKey !== undefined) attempts.delete(oldestKey);
    }
    attempts.set(key, { count: 1, resetAt: nowSeconds + windowSeconds });
    return { allowed: true, retryAfter: 0 };
  }

  if (existing.count >= maxAttempts) {
    return { allowed: false, retryAfter: Math.max(1, existing.resetAt - nowSeconds) };
  }

  existing.count += 1;
  attempts.set(key, existing);
  return { allowed: true, retryAfter: 0 };
}

export function getRequestClientAddress(request: Request, directAddress: string, trustProxy: boolean): string {
  if (!trustProxy) return directAddress;

  const nearestForwardedHop = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .at(-1)
    ?.trim();
  return nearestForwardedHop && isIP(nearestForwardedHop) ? nearestForwardedHop : directAddress;
}
