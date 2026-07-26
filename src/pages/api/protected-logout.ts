import type { APIRoute } from "astro";
import { protectedCookieName, protectedCookieSecure } from "../../lib/protected-auth";

const headers = () =>
  new Headers({
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  });

const sameOrigin = (request: Request) => {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;
  try {
    return new URL(suppliedOrigin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!sameOrigin(request)) {
    const responseHeaders = headers();
    responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
    return new Response("Unable to sign out.", { status: 403, headers: responseHeaders });
  }

  const responseHeaders = headers();
  const secure = protectedCookieSecure();
  const secureAttribute = secure ? "; Secure" : "";
  responseHeaders.set("Location", "/member-portal");
  responseHeaders.set(
    "Set-Cookie",
    `${protectedCookieName(secure)}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureAttribute}; SameSite=Lax`,
  );
  return new Response(null, { status: 303, headers: responseHeaders });
};
