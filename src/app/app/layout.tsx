import { eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { LogoutButton } from "@/components/app-shell/logout-button";
import { OrgSwitcher } from "@/components/app-shell/org-switcher";
import { TopbarBreadcrumb } from "@/components/app-shell/topbar-breadcrumb";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { listAcceptedMemberships, resolveActiveOrg } from "@/server/active-org";

// Capa real de protección de /app (proxy.ts es solo la primera capa, chequeo de cookie) —
// blueprint.md §8.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const [dbUser] = await db.select().from(userTable).where(eq(userTable.id, session.user.id));
  const isPlatformAdmin = dbUser?.platformRole === "platform_admin";

  const memberships = await listAcceptedMemberships(session.user.id);
  // Sin membresías y sin ser superadmin (que ya tiene acceso plataforma-wide sin necesitar una
  // org propia) — primera vez en la plataforma, se crea su espacio de trabajo individual antes de
  // ver el resto del panel (docs/roles-y-workspaces-2026-08.md).
  if (memberships.length === 0 && !isPlatformAdmin) redirect("/bienvenida");

  const activeOrg = await resolveActiveOrg(session.user.id);

  return (
    <div className="flex min-h-full">
      <AppSidebar isPlatformAdmin={isPlatformAdmin} />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-border bg-card px-6 py-3">
          {memberships.length > 1 && activeOrg ? (
            <OrgSwitcher memberships={memberships} activeOrgId={activeOrg.orgId} />
          ) : (
            <span className="text-sm font-medium text-foreground">
              {activeOrg?.orgName ?? "Sin organización"}
            </span>
          )}
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/app/copiloto"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-4" />
              Crear agente
            </Link>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.user.email}
            </span>
            <LogoutButton />
          </div>
        </header>
        {activeOrg?.orgStatus === "blocked" && (
          <div className="bg-destructive/10 px-6 py-2 text-center text-sm font-medium text-destructive">
            {activeOrg.orgName} está bloqueada por la plataforma — no puede enviar mensajes ni
            activar agentes hasta que un superadmin la desbloquee.
          </div>
        )}
        <TopbarBreadcrumb orgName={activeOrg?.orgName ?? "Sin organización"} />
        <main className="flex-1 bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
