import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ChatThread } from "@/components/chat/chat-thread";
import { auth } from "@/lib/auth";
import { resolveActiveOrg } from "@/server/active-org";
import { loadChatHistory } from "@/server/agent/chat-history";
import { requireMembership } from "@/server/permissions";

export const metadata = { title: "Copiloto — GEIFEM Agentes" };

// El copiloto no es un agente de catálogo (docs/plataforma-multiagente-pivot.md §5) — esta página
// es su único punto de entrada, siempre disponible, sin activación ni fila en agent_config.
export default async function CopilotoPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();

  const initialMessages = await loadChatHistory({
    orgId: activeOrg.orgId,
    agentType: "platform_copilot",
    triggerType: "copilot_request",
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Copiloto de plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Cuéntale qué necesitas automatizar para {activeOrg.orgName} — te ayuda a armar un agente
          nuevo.
        </p>
      </div>
      <ChatThread
        initialMessages={initialMessages}
        // Solo admin: el copiloto puede guardar credenciales de terceros (create_custom_connector)
        // y activar agentes — tratamos el acceso al copiloto como una capacidad administrativa en
        // v1, no de uso general (docs/roles-y-workspaces-2026-08.md).
        canSend={membershipCheck.data.role === "owner"}
        endpoint="/api/v1/copilot"
        emptyHint='Por ejemplo: "quiero un agente que avise cuando una factura está por vencer".'
        disabledHint="Solo un administrador de la organización puede usar el copiloto — puede crear conectores con credenciales."
      />
    </div>
  );
}
