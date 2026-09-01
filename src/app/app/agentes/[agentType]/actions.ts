"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfig, appConnections, customAgents, organization } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { writeAuditLog } from "@/server/audit";
import { requireMembership } from "@/server/permissions";

export type ActionResult = { ok: true } | { ok: false; error: string };

const updateAuxContableConfigSchema = z.object({
  enabled: z.boolean(),
  soporteThresholdCents: z.coerce.number().int().nonnegative(),
  tone: z.string().trim().max(200).optional().or(z.literal("")),
  businessDescription: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** Configuración del agente de catálogo Aux Contable — habilitado, umbral de soporte, tono y
 * descripción del negocio (inyectados en el prompt por assembleSystemPrompt, nunca reemplazan la
 * distinción soporte-audit decidida en código). */
export async function updateAuxContableConfigAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return { ok: false, error: "No tienes una organización activa." };

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const parsed = updateAuxContableConfigSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    soporteThresholdCents: formData.get("soporteThresholdCents"),
    tone: formData.get("tone"),
    businessDescription: formData.get("businessDescription"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const [existing] = await db
    .select({ businessRules: agentConfig.businessRules })
    .from(agentConfig)
    .where(and(eq(agentConfig.orgId, activeOrg.orgId), eq(agentConfig.agentType, "aux_contable")));

  const businessRules = {
    ...((existing?.businessRules as Record<string, unknown>) ?? {}),
    soporte_threshold_cents: parsed.data.soporteThresholdCents,
    tone: parsed.data.tone || undefined,
    business_description: parsed.data.businessDescription || undefined,
  };

  if (existing) {
    await db
      .update(agentConfig)
      .set({ enabled: parsed.data.enabled, businessRules, updatedAt: new Date() })
      .where(
        and(eq(agentConfig.orgId, activeOrg.orgId), eq(agentConfig.agentType, "aux_contable")),
      );
  } else {
    await db.insert(agentConfig).values({
      orgId: activeOrg.orgId,
      agentType: "aux_contable",
      enabled: parsed.data.enabled,
      businessRules,
    });
  }

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "agent_config.updated",
    targetType: "agent_config",
    targetId: activeOrg.orgId,
    metadata: { agentType: "aux_contable", enabled: parsed.data.enabled, businessRules },
  });

  revalidatePath("/app/agentes/aux_contable/configuracion");
  return { ok: true };
}

const updateWhatsappNumberSchema = z.object({
  // E.164 sin '+', tal como lo manda la Cloud API en el campo "from" (ej. "573001234567").
  whatsappNumber: z
    .string()
    .trim()
    .regex(/^[1-9]\d{6,14}$/, "Usa solo dígitos, sin '+' ni espacios (formato E.164)")
    .optional()
    .or(z.literal("")),
});

export async function updateWhatsappNumberAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return { ok: false, error: "No tienes una organización activa." };

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const parsed = updateWhatsappNumberSchema.safeParse({
    whatsappNumber: formData.get("whatsappNumber"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Número inválido." };
  }

  const whatsappNumber = parsed.data.whatsappNumber || null;

  try {
    await db
      .update(organization)
      .set({ whatsappNumber })
      .where(eq(organization.id, activeOrg.orgId));
  } catch {
    return { ok: false, error: "Ese número ya está conectado a otra organización." };
  }

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "organization.whatsapp_number_updated",
    targetType: "organization",
    targetId: activeOrg.orgId,
    metadata: { whatsappNumber },
  });

  revalidatePath("/app/agentes/aux_contable/configuracion");
  return { ok: true };
}

const updateTelegramChatIdSchema = z.object({
  // chat.id numérico que Telegram manda en cada update — el cliente lo obtiene escribiéndole al
  // bot y el operador lo copia aquí (no hay forma de saberlo de antemano, a diferencia del número
  // de WhatsApp del propio cliente).
  telegramChatId: z
    .string()
    .trim()
    .regex(/^-?\d+$/, "Usa solo dígitos (el chat.id numérico de Telegram)")
    .optional()
    .or(z.literal("")),
});

export async function updateTelegramChatIdAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return { ok: false, error: "No tienes una organización activa." };

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const parsed = updateTelegramChatIdSchema.safeParse({
    telegramChatId: formData.get("telegramChatId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Chat ID inválido." };
  }

  const telegramChatId = parsed.data.telegramChatId || null;

  try {
    await db
      .update(organization)
      .set({ telegramChatId })
      .where(eq(organization.id, activeOrg.orgId));
  } catch {
    return { ok: false, error: "Ese chat ya está conectado a otra organización." };
  }

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "organization.telegram_chat_id_updated",
    targetType: "organization",
    targetId: activeOrg.orgId,
    metadata: { telegramChatId },
  });

  revalidatePath("/app/agentes/aux_contable/configuracion");
  return { ok: true };
}

const updateCustomAgentDetailsSchema = z.object({
  customAgentId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
});

/** Nombre/descripción de un agente custom — el system_prompt en sí no se edita a mano libre acá
 * (docs/plataforma-multiagente-pivot.md §6): para cambiarlo, se sigue la conversación con el
 * copiloto, que lo reescribe con `save_custom_agent`. */
export async function updateCustomAgentDetailsAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return { ok: false, error: "No tienes una organización activa." };

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const parsed = updateCustomAgentDetailsSchema.safeParse({
    customAgentId: formData.get("customAgentId"),
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const [updated] = await db
    .update(customAgents)
    .set({ name: parsed.data.name, description: parsed.data.description, updatedAt: new Date() })
    .where(
      and(eq(customAgents.id, parsed.data.customAgentId), eq(customAgents.orgId, activeOrg.orgId)),
    )
    .returning({ id: customAgents.id });
  if (!updated) return { ok: false, error: "Agente no encontrado." };

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "custom_agent.updated",
    targetType: "custom_agents",
    targetId: updated.id,
  });

  revalidatePath(`/app/agentes/${parsed.data.customAgentId}/configuracion`);
  return { ok: true };
}

const updateCustomAgentConnectorSchema = z.object({
  customAgentId: z.string().uuid(),
  connectorId: z.string().uuid().optional().or(z.literal("")),
});

/** Reasigna qué conector usa un agente custom — entre conectores `platform_rest` o `custom_rest`
 * de la organización (`mcp` todavía no soportado por el loop, ver src/server/agent/loop.ts). */
export async function updateCustomAgentConnectorAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return { ok: false, error: "No tienes una organización activa." };

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const parsed = updateCustomAgentConnectorSchema.safeParse({
    customAgentId: formData.get("customAgentId"),
    connectorId: formData.get("connectorId"),
  });
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const connectorId = parsed.data.connectorId || null;

  if (connectorId) {
    const [connectorRow] = await db
      .select({ kind: appConnections.kind })
      .from(appConnections)
      .where(and(eq(appConnections.id, connectorId), eq(appConnections.orgId, activeOrg.orgId)));
    if (!connectorRow) return { ok: false, error: "Conector no encontrado." };
    if (connectorRow.kind !== "platform_rest" && connectorRow.kind !== "custom_rest") {
      return { ok: false, error: "Ese tipo de conector todavía no está soportado por el loop." };
    }
  }

  const [updated] = await db
    .update(customAgents)
    .set({ connectorId, updatedAt: new Date() })
    .where(
      and(eq(customAgents.id, parsed.data.customAgentId), eq(customAgents.orgId, activeOrg.orgId)),
    )
    .returning({ id: customAgents.id });
  if (!updated) return { ok: false, error: "Agente no encontrado." };

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "custom_agent.connector_updated",
    targetType: "custom_agents",
    targetId: updated.id,
    metadata: { connectorId },
  });

  revalidatePath(`/app/agentes/${parsed.data.customAgentId}/conectores`);
  return { ok: true };
}
