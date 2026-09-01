import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// Next.js 16: middleware.ts fue renombrado a proxy.ts y la función exportada es `proxy`, no
// `middleware`. Corre en el runtime de Node por defecto. Ver knowledge/runtime-tracks/ts-node.md
// Gotchas — Server Functions (POSTs a la ruta que las usa) NO pasan por este matcher, así que la
// autorización real vive en cada Server Function / route handler, esto es solo la primera capa.
//
// getSessionCookie solo verifica que la cookie de sesión de better-auth esté presente (sin tocar
// la DB) — es una capa rápida de UX, no autorización real. requireMembership/requirePlatformAdmin
// en cada Server Component / route handler son la capa que sí valida contra la sesión y la DB.

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/politica-de-privacidad",
  "/api/webhooks",
  // better-auth necesita ser alcanzable SIN cookie — es como se obtiene la cookie en primer
  // lugar (login, signup, callbacks). Bloquearlo deja a cualquier visitante nuevo sin forma de
  // iniciar sesión.
  "/api/auth",
  // Los schedulers externos (cron del host, GitHub Actions, etc.) llaman a estas rutas sin cookie
  // de sesión — se autentican con `Authorization: Bearer $CRON_SECRET`, verificado dentro de cada
  // route handler. Sin esta excepción, el proxy los redirige a /login antes de que ese chequeo
  // corra (.claude/rules/api-routes.md).
  "/api/cron",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

  const sessionCookie = getSessionCookie(request);
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
