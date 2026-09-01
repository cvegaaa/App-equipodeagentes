import { and, desc, eq } from "drizzle-orm";
import { Sparkles } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { activateCustomAgentAction } from "@/app/app/agentes/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfig, customAgents } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { CATALOG_AGENTS } from "@/server/agent/workspace";
import { requireMembership } from "@/server/permissions";

export const metadata = { title: "Agentes — GEIFEM Agentes" };

const STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  draft: "Borrador",
  archived: "Archivado",
};

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "draft") return "secondary";
  return "outline";
}

export default async function AgentesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();
  const canEdit = membershipCheck.data.role === "owner";

  const [auxContableConfig] = await db
    .select({ enabled: agentConfig.enabled })
    .from(agentConfig)
    .where(and(eq(agentConfig.orgId, activeOrg.orgId), eq(agentConfig.agentType, "aux_contable")));

  const customAgentRows = await db
    .select()
    .from(customAgents)
    .where(eq(customAgents.orgId, activeOrg.orgId))
    .orderBy(desc(customAgents.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Agentes</h1>
        <p className="text-sm text-muted-foreground">
          Los agentes de {activeOrg.orgName} — del catálogo o creados con el copiloto.
        </p>
      </div>

      <Link
        href="/app/copiloto"
        className="flex items-center gap-4 rounded-xl bg-gradient-to-br from-primary to-chart-2 px-6 py-5 text-primary-foreground shadow-md transition-transform hover:-translate-y-0.5"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <Sparkles className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold tracking-wide uppercase opacity-80">
            Copiloto de plataforma
          </span>
          <span className="block text-base font-semibold">¿Qué necesitas automatizar?</span>
          <span className="block text-sm opacity-90">
            Entrevista y arma un agente nuevo — no es una entrada del catálogo.
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold">Crear agente →</span>
      </Link>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle>{CATALOG_AGENTS.aux_contable.name}</CardTitle>
              <Badge variant={auxContableConfig?.enabled ? "default" : "secondary"}>
                {auxContableConfig?.enabled ? "Activo" : "Deshabilitado"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {CATALOG_AGENTS.aux_contable.description}
            </p>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                catálogo
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                alegra
              </span>
            </div>
            <Button asChild size="sm" variant="secondary">
              <Link href="/app/agentes/aux_contable">
                {auxContableConfig?.enabled ? "Abrir" : "Configurar"}
              </Link>
            </Button>
          </CardContent>
        </Card>

        {customAgentRows.map((agentRow) => (
          <Card key={agentRow.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{agentRow.name}</CardTitle>
                <Badge variant={statusBadgeVariant(agentRow.status)}>
                  {STATUS_LABEL[agentRow.status] ?? agentRow.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{agentRow.description}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                  custom
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {agentRow.status === "active" ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/app/agentes/${agentRow.id}`}>Abrir</Link>
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/app/agentes/${agentRow.id}/configuracion`}>Configurar</Link>
                  </Button>
                )}
                {agentRow.status === "draft" && canEdit && (
                  <form action={activateCustomAgentAction}>
                    <input type="hidden" name="customAgentId" value={agentRow.id} />
                    <Button size="sm" disabled={!agentRow.connectorId}>
                      {agentRow.connectorId ? "Activar" : "Falta conectar un proveedor"}
                    </Button>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
