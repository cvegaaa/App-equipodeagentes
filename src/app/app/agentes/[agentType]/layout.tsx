import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentWorkspaceTabs } from "@/components/agentes/agent-workspace-tabs";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";
import { resolveActiveOrg } from "@/server/active-org";
import { resolveAgentWorkspace } from "@/server/agent/workspace";
import { requireMembership } from "@/server/permissions";

const STATUS_LABEL: Record<string, string> = { draft: "Borrador", archived: "Archivado" };

// El "workspace" de un agente — catálogo o custom, mismo patrón para ambos
// (docs/rediseno-panel-2026-08.md). Chat/Configuración/Conectores viven adentro, no como páginas
// sueltas del sidebar: seleccionar un agente es entrar a su propio espacio, no a una config global.
export default async function AgentWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ agentType: string }>;
}) {
  const { agentType } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();

  const workspace = await resolveAgentWorkspace(agentType, activeOrg.orgId);
  if (!workspace) notFound();

  const statusLabel =
    workspace.kind === "catalog"
      ? workspace.enabled
        ? "Activo"
        : "Deshabilitado"
      : (STATUS_LABEL[workspace.status] ?? "Activo");

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/app/agentes" className="hover:text-foreground">
            Agentes
          </Link>
          <span>›</span>
          <span className="font-medium text-foreground">{workspace.name}</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">{workspace.name}</h1>
          <Badge variant={statusLabel === "Activo" ? "default" : "secondary"}>{statusLabel}</Badge>
          {workspace.kind === "custom" && <Badge variant="outline">custom</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{workspace.description}</p>
      </div>

      <AgentWorkspaceTabs basePath={`/app/agentes/${agentType}`} />

      {children}
    </div>
  );
}
