import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { activateCustomAgentAction } from "@/app/app/agentes/actions";
import { AgentConfigForm } from "@/components/agentes/agent-config-form";
import { CustomAgentDetailsForm } from "@/components/agentes/custom-agent-details-form";
import { TelegramChatIdForm } from "@/components/agentes/telegram-chat-id-form";
import { WhatsappNumberForm } from "@/components/agentes/whatsapp-number-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfig, organization } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { resolveAgentWorkspace } from "@/server/agent/workspace";
import { requireMembership } from "@/server/permissions";

export default async function AgentConfiguracionTab({
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

  if (workspace.kind === "custom") {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <CustomAgentDetailsForm
              customAgentId={workspace.id}
              canEdit={canEdit}
              name={workspace.name}
              description={workspace.description}
              systemPrompt={workspace.systemPrompt}
            />
          </CardContent>
        </Card>

        {workspace.status === "draft" && canEdit && (
          <Card>
            <CardHeader>
              <CardTitle>Activar agente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {workspace.connectorId
                  ? "Ya tiene un conector asignado — puedes activarlo."
                  : "Elige un conector en la pestaña Conectores antes de activarlo."}
              </p>
              <form action={activateCustomAgentAction}>
                <input type="hidden" name="customAgentId" value={workspace.id} />
                <Button type="submit" disabled={!workspace.connectorId}>
                  Activar
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const [config] = await db
    .select()
    .from(agentConfig)
    .where(and(eq(agentConfig.orgId, activeOrg.orgId), eq(agentConfig.agentType, "aux_contable")));

  const businessRules =
    (config?.businessRules as {
      soporte_threshold_cents?: number;
      tone?: string;
      business_description?: string;
    }) ?? {};

  const [org] = await db
    .select({
      whatsappNumber: organization.whatsappNumber,
      telegramChatId: organization.telegramChatId,
    })
    .from(organization)
    .where(eq(organization.id, activeOrg.orgId));

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <AgentConfigForm
            canEdit={canEdit}
            enabled={config?.enabled ?? false}
            soporteThresholdCents={businessRules.soporte_threshold_cents ?? 1_000_000}
            tone={businessRules.tone ?? ""}
            businessDescription={businessRules.business_description ?? ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Canales de comunicación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <WhatsappNumberForm canEdit={canEdit} whatsappNumber={org?.whatsappNumber ?? ""} />
          <TelegramChatIdForm canEdit={canEdit} telegramChatId={org?.telegramChatId ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
