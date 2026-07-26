import type { APIRoute } from "astro";
import {
  consumeLoginAttempt,
  createSessionToken,
  getRequestClientAddress,
  hasSupportedPasswordHash,
  hasValidSessionSecret,
  normalizeProtectedReturnTo,
  protectedCookieName,
  protectedCookieSecure,
  PROTECTED_SCOPE,
  PROTECTED_SESSION_SECONDS,
  readProtectedRuntimeConfig,
  verifyPassword,
  type LoginAttemptState,
} from "../../lib/protected-auth";

const attempts = new Map<string, LoginAttemptState>();
const MAX_FORM_BYTES = 4_096;

export class ProtectedFormError extends Error {
  constructor(public status: 400 | 413 | 415) {
    super("Invalid protected login form");
  }
}

export async function readProtectedForm(request: Request, maxBytes = MAX_FORM_BYTES): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") throw new ProtectedFormError(415);

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new ProtectedFormError(413);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return new URLSearchParams();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the size-limit response even if the stream cannot be cancelled cleanly.
      }
      throw new ProtectedFormError(413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

const baseHeaders = () =>
  new Headers({
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  });

const textResponse = (status: number, message: string, additionalHeaders?: HeadersInit) => {
  const headers = baseHeaders();
  headers.set("Content-Type", "text/plain; charset=utf-8");
  if (additionalHeaders) {
    for (const [name, value] of new Headers(additionalHeaders)) headers.set(name, value);
  }
  return new Response(message, { status, headers });
};

const sameOrigin = (request: Request) => {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;
  try {
    return new URL(suppliedOrigin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
};

const failedLoginLocation = (returnTo: string) => {
  const url = new URL(returnTo, "https://protected.local");
  url.searchParams.set("loginError", "1");
  return `${url.pathname}${url.search}`;
};

const sessionCookie = (token: string) => {
  const secure = protectedCookieSecure();
  const secureAttribute = secure ? "; Secure" : "";
  return `${protectedCookieName(secure)}=${token}; Path=/; Max-Age=${PROTECTED_SESSION_SECONDS}; HttpOnly${secureAttribute}; SameSite=Lax`;
};

export const POST: APIRoute = async (context) => {
  const { request } = context;
  if (!sameOrigin(request)) return textResponse(403, "Unable to sign in.");

  let form: URLSearchParams;
  try {
    form = await readProtectedForm(request);
  } catch (error) {
    return textResponse(error instanceof ProtectedFormError ? error.status : 400, "Unable to sign in.");
  }

  const passwordValue = form.get("password");
  const returnToValue = form.get("returnTo");
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const returnTo = normalizeProtectedReturnTo(typeof returnToValue === "string" ? returnToValue : undefined);

  let directAddress = "unknown";
  try {
    directAddress = context.clientAddress || directAddress;
  } catch {
    // Some adapters cannot provide a socket address; keep one bounded fallback bucket.
  }
  const clientAddress = getRequestClientAddress(
    request,
    directAddress,
    process.env.FCFL_TRUST_PROXY === "true",
  );
  const attempt = consumeLoginAttempt(attempts, clientAddress);
  if (!attempt.allowed) {
    return textResponse(429, "Unable to sign in.", { "Retry-After": String(attempt.retryAfter) });
  }

  const { sessionSecret: secret, passwordHash: encodedHash } = readProtectedRuntimeConfig();
  if (!hasValidSessionSecret(secret) || !hasSupportedPasswordHash(encodedHash)) {
    return textResponse(503, "Unable to sign in.");
  }

  if (!(await verifyPassword(password, encodedHash))) {
    const headers = baseHeaders();
    headers.set("Location", failedLoginLocation(returnTo));
    return new Response(null, { status: 303, headers });
  }

  const token = createSessionToken(secret, PROTECTED_SCOPE);
  const headers = baseHeaders();
  headers.set("Location", returnTo);
  headers.set("Set-Cookie", sessionCookie(token));
  return new Response(null, { status: 303, headers });
};
