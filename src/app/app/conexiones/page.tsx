import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ConnectionForm } from "@/components/conexiones/connection-form";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appConnections } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { requireMembership } from "@/server/permissions";

export const metadata = { title: "Conexiones — GEIFEM Agentes" };

export default async function ConexionesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();

  const canEdit = membershipCheck.data.role === "owner";

  const [connection] = await db
    .select({
      providerKey: appConnections.providerKey,
      baseUrl: appConnections.baseUrl,
      authType: appConnections.authType,
      authHeaderName: appConnections.authHeaderName,
      updatedAt: appConnections.updatedAt,
    })
    .from(appConnections)
    .where(
      and(eq(appConnections.orgId, activeOrg.orgId), eq(appConnections.providerKey, "alegra")),
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Conexiones</h1>
        <p className="text-sm text-muted-foreground">
          Conecta {activeOrg.orgName} con Alegra u otro proveedor REST con token — el token nunca se
          muestra de nuevo una vez guardado.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {connection && (
            <p className="text-sm text-muted-foreground">
              Conexión actual: <span className="text-foreground">{connection.providerKey}</span> —{" "}
              {connection.baseUrl} ({connection.authType})
            </p>
          )}

          {canEdit ? (
            <ConnectionForm />
          ) : (
            <p className="text-sm text-muted-foreground">
              Solo un administrador puede crear o cambiar la conexión de esta organización.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
