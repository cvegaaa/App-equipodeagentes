"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { customAgents } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { writeAuditLog } from "@/server/audit";
import { assertOrgActive } from "@/server/org-status";
import { requireMembership } from "@/server/permissions";

const activateSchema = z.object({ customAgentId: z.string().uuid() });

/**
 * Activa un agente custom en `draft` — exige `connectorId` ya elegido (sin conector, el loop nunca
 * podría correrlo, ver `resolveCustomAgentDefinition` en `src/server/agent/loop.ts`). Solo `owner`
 * (administrador) — activar un agente es una acción de gestión de la organización
 * (docs/roles-y-workspaces-2026-08.md).
 */
export async function activateCustomAgentAction(formData: FormData): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return;

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return;

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return;

  const orgGuard = await assertOrgActive(activeOrg.orgId);
  if (!orgGuard.ok) return;

  const parsed = activateSchema.safeParse({ customAgentId: formData.get("customAgentId") });
  if (!parsed.success) return;

  const [row] = await db
    .select({ connectorId: customAgents.connectorId })
    .from(customAgents)
    .where(
      and(eq(customAgents.id, parsed.data.customAgentId), eq(customAgents.orgId, activeOrg.orgId)),
    );
  if (!row?.connectorId) return;

  await db
    .update(customAgents)
    .set({ status: "active", updatedAt: new Date() })
    .where(
      and(eq(customAgents.id, parsed.data.customAgentId), eq(customAgents.orgId, activeOrg.orgId)),
    );

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "custom_agent.activated",
    targetType: "custom_agents",
    targetId: parsed.data.customAgentId,
  });

  revalidatePath("/app/agentes");
}
