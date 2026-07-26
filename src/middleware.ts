import { defineMiddleware } from "astro:middleware";
import {
  hasSupportedPasswordHash,
  hasValidSessionSecret,
  protectedCookieName,
  PROTECTED_SCOPE,
  readProtectedRuntimeConfig,
  verifySessionToken,
} from "./lib/protected-auth";

export const PROTECTED_PATHS = new Set(["/member-portal", "/membership2"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const isProtected = PROTECTED_PATHS.has(context.url.pathname);
  context.locals.protectedAuthorized = false;
  context.locals.protectedAvailable = false;

  if (isProtected) {
    const { passwordHash, sessionSecret } = readProtectedRuntimeConfig();
    context.locals.protectedAvailable =
      hasValidSessionSecret(sessionSecret) && hasSupportedPasswordHash(passwordHash);
    const token = context.cookies.get(protectedCookieName())?.value;
    context.locals.protectedAuthorized =
      context.locals.protectedAvailable && verifySessionToken(token, sessionSecret, PROTECTED_SCOPE);
  }

  let response = await next();
  if (isProtected) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Vary", "Cookie");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
});
