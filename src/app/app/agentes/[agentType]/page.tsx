import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ChatThread } from "@/components/chat/chat-thread";
import { auth } from "@/lib/auth";
import { resolveActiveOrg } from "@/server/active-org";
import { loadChatHistory } from "@/server/agent/chat-history";
import { resolveAgentWorkspace } from "@/server/agent/workspace";
import { requireMembership } from "@/server/permissions";

export default async function AgentChatTab({ params }: { params: Promise<{ agentType: string }> }) {
  const { agentType } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();

  const workspace = await resolveAgentWorkspace(agentType, activeOrg.orgId);
  if (!workspace) notFound();

  const runnable = workspace.kind === "catalog" ? workspace.enabled : workspace.status === "active";

  const initialMessages = await loadChatHistory({
    orgId: activeOrg.orgId,
    agentType: workspace.agentType,
    triggerType: "chat_request",
  });

  return (
    <ChatThread
      initialMessages={initialMessages}
      // Cualquier miembro aceptado (admin o usuario) puede chatear con un agente ya activo — la
      // distinción de rol es sobre quién administra la organización, no sobre quién usa un agente
      // ya configurado (docs/roles-y-workspaces-2026-08.md).
      canSend={runnable}
      agentType={workspace.agentType}
      emptyHint={`Escríbele a ${workspace.name} para empezar.`}
      disabledHint={`${workspace.name} todavía no está activo — actívalo desde la pestaña Configuración.`}
    />
  );
}
