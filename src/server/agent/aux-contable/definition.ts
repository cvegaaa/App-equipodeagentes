import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getToolRegistry } from "@/lib/connectors/registry";
import { db } from "@/lib/db";
import { agentConfig } from "@/lib/db/schema";
import { registerAgentDefinition, type SystemPromptContext } from "@/server/agent/loop";
import { AUX_CONTABLE_BASE_PROMPT, SOPORTE_AUDIT_INSTRUCTION } from "./prompt";

export const businessRulesSchema = z
  .object({
    // Umbral (centavos) sobre el cual un documento requiere revisión de soporte adjunto en
    // Alegra. Configurable por organización desde /app/agentes/aux_contable/configuracion.
    soporte_threshold_cents: z.number().int().nonnegative().default(1_000_000),
    // Tono y contexto de negocio — texto libre, se inyectan tal cual en el prompt (nunca
    // reemplazan las reglas de la regla 9 / soporte-audit, que siguen decididas en código).
    tone: z.string().trim().max(200).optional(),
    business_description: z.string().trim().max(1000).optional(),
  })
  .passthrough();
export type BusinessRules = z.infer<typeof businessRulesSchema>;

type AssemblePromptParams = {
  triggerType: string;
  businessRules: BusinessRules;
  /** Monto del documento en centavos, si el llamador ya lo conoce al momento de armar el prompt. */
  documentAmountCents?: number;
};

/**
 * Ensambla el system prompt del Aux Contable. Función pura — la distinción soporte-audit se
 * decide aquí, en código, nunca solo confiada a que el modelo respete una instrucción condicional
 * dentro de un único prompt siempre igual (CLAUDE.md regla 9 / .claude/rules/agent-loop.md).
 *
 * La auditoría de soporte SOLO aplica a `trigger_type='chat_request'` — un run `dian_sync` nunca
 * la incluye, sin importar el monto.
 */
export function assembleSystemPrompt(params: AssemblePromptParams): string {
  const requiresSoporteAudit =
    params.triggerType === "chat_request" &&
    params.documentAmountCents !== undefined &&
    params.documentAmountCents > params.businessRules.soporte_threshold_cents;

  let prompt = AUX_CONTABLE_BASE_PROMPT;

  const { tone, business_description } = params.businessRules;
  if (business_description || tone) {
    const lines = [
      "\n\nContexto de esta organización, configurado por el cliente:",
      business_description ? `- A qué se dedica: ${business_description}` : null,
      tone ? `- Tono esperado en tus respuestas: ${tone}` : null,
    ].filter((line): line is string => line !== null);
    prompt += lines.join("\n");
  }

  return requiresSoporteAudit ? `${prompt}\n\n${SOPORTE_AUDIT_INSTRUCTION}` : prompt;
}

type AgentConfigRow = { enabled: boolean } | null | undefined;

/**
 * Guarda usada antes de encolar un nuevo run (E2-T3/E2-T4 la llaman desde los triggers) — nunca
 * se crea `runs`+`jobs` para una organización con el agente deshabilitado.
 */
export function assertAgentEnabled(
  config: AgentConfigRow,
): { ok: true } | { ok: false; error: { code: "agent_disabled"; message: string } } {
  if (!config?.enabled) {
    return {
      ok: false,
      error: {
        code: "agent_disabled",
        message: "El agente Aux Contable está deshabilitado para esta organización.",
      },
    };
  }
  return { ok: true };
}

function extractDocumentAmountCents(input: unknown): number | undefined {
  if (input && typeof input === "object" && "documentAmountCents" in input) {
    const value = (input as { documentAmountCents?: unknown }).documentAmountCents;
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
}

async function buildSystemPrompt(ctx: SystemPromptContext): Promise<string> {
  const [config] = await db
    .select()
    .from(agentConfig)
    .where(and(eq(agentConfig.orgId, ctx.orgId), eq(agentConfig.agentType, "aux_contable")));
  const businessRules = businessRulesSchema.parse(config?.businessRules ?? {});
  return assembleSystemPrompt({
    triggerType: ctx.triggerType,
    businessRules,
    documentAmountCents: extractDocumentAmountCents(ctx.input),
  });
}

registerAgentDefinition({
  agentType: "aux_contable",
  systemPrompt: buildSystemPrompt,
  tools: getToolRegistry("alegra") ?? {},
  maxSteps: 20,
  maxTokensPerCall: 4_096,
  providerKey: "alegra",
});
