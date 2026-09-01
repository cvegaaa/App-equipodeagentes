import { type NextRequest, NextResponse } from "next/server";

// Next.js 16: middleware.ts fue renombrado a proxy.ts y la función exportada es `proxy`, no
// `middleware`. Corre en el runtime de Node por defecto. Ver knowledge/runtime-tracks/ts-node.md
// Gotchas — Server Functions (POSTs a la ruta que las usa) NO pasan por este matcher, así que la
// autorización real vive en cada Server Function / route handler, esto es solo la primera capa.

const PUBLIC_PATHS = ["/", "/login", "/signup", "/politica-de-privacidad", "/api/webhooks"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

  const sessionCookie = request.cookies.get("geifem_session");
  if (!sessionCookie) {
    const signInUrl = new URL("/login", request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
