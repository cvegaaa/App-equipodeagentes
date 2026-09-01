import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomAgentConnectorForm } from "@/components/agentes/custom-agent-connector-form";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appConnections } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { resolveAgentWorkspace } from "@/server/agent/workspace";
import { requireMembership } from "@/server/permissions";

export default async function AgentConectoresTab({
  params,
}: {
  params: Promise<{ agentType: string }>;
}) {
  const { agentType } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();
  const canEdit = membershipCheck.data.role === "owner";

  const workspace = await resolveAgentWorkspace(agentType, activeOrg.orgId);
  if (!workspace) notFound();

  if (workspace.kind === "catalog") {
    // Aux Contable siempre usa el Alegra de la organización (providerKey fijo en
    // src/server/agent/aux-contable/definition.ts) — esta pestaña lo muestra en contexto, la
    // edición sigue viviendo en /app/conexiones para no duplicar ese formulario.
    const [connection] = await db
      .select({
        baseUrl: appConnections.baseUrl,
        authType: appConnections.authType,
        updatedAt: appConnections.updatedAt,
      })
      .from(appConnections)
      .where(
        and(
          eq(appConnections.orgId, activeOrg.orgId),
          eq(appConnections.kind, "platform_rest"),
          eq(appConnections.providerKey, "alegra"),
        ),
      );

    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          {connection ? (
            <p className="text-sm text-muted-foreground">
              Conectado a <span className="font-medium text-foreground">Alegra</span> —{" "}
              {connection.baseUrl} ({connection.authType})
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Todavía no hay una conexión a Alegra para esta organización.
            </p>
          )}
          <Link href="/app/conexiones" className="text-sm font-medium text-primary hover:underline">
            {connection ? "Editar en Conexiones →" : "Conectar Alegra →"}
          </Link>
        </CardContent>
      </Card>
    );
  }

  const options = await db
    .select({
      id: appConnections.id,
      kind: appConnections.kind,
      name: appConnections.name,
      providerKey: appConnections.providerKey,
    })
    .from(appConnections)
    .where(
      and(
        eq(appConnections.orgId, activeOrg.orgId),
        inArray(appConnections.kind, ["platform_rest", "custom_rest"]),
      ),
    );

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CustomAgentConnectorForm
          customAgentId={workspace.id}
          canEdit={canEdit}
          connectorId={workspace.connectorId}
          options={options.map((option) => ({
            id: option.id,
            label: `${option.name ?? option.providerKey ?? option.id} (${option.kind})`,
          }))}
        />
        <p className="text-sm text-muted-foreground">
          Para conectar una API propia del cliente (no un proveedor curado), pídeselo al{" "}
          <Link href="/app/copiloto" className="font-medium text-primary hover:underline">
            copiloto
          </Link>{" "}
          — te pregunta la URL y la credencial, y define las operaciones.
        </p>
      </CardContent>
    </Card>
  );
}
