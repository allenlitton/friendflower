import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Pages anyone can open without signing in.
const PUBLIC_PATHS = ["/signin", "/auth", "/invite", "/privacy", "/opengraph-image"];

// Keeps the Supabase session fresh on every request and sends signed-out
// visitors to the sign-in page.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!signedIn && !isPublic && !path.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return redirectKeepingCookies(url, response);
  }

  // Already signed in: skip the sign-in screen. The home-screen app can reopen
  // on an old sign-in page even though the session is still good.
  if (signedIn && path === "/signin") {
    const next = request.nextUrl.searchParams.get("next") ?? "/";
    const url = new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/", request.url);
    return redirectKeepingCookies(url, response);
  }
  return response;
}

// A redirect is a new response, so carry over any refreshed session cookies.
// Dropping them would leave the browser with a refresh token that's already used.
function redirectKeepingCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  from.headers.forEach((v, k) => {
    if (k === "cache-control" || k === "expires" || k === "pragma") redirect.headers.set(k, v);
  });
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest|photos|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
