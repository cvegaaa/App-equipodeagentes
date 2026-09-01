import type { z } from "zod";
import { alegraTools } from "@/lib/connectors/providers/alegra/tools";
import type { RestConnection } from "@/lib/connectors/rest-client";

// `connection` es un valor inerte (nunca leído) cuando el agente no tiene proveedor externo — ver
// AgentDefinition.providerKey en src/server/agent/loop.ts. `orgId`/`input` están disponibles para
// tools internas de la plataforma (p. ej. el copiloto, src/server/agent/platform-copilot/tools.ts)
// que necesitan el contexto del run sin pasar por rest-client.ts.
export type ToolContext = {
  connection: RestConnection;
  idempotencyKey: string;
  orgId: string;
  input: unknown;
};

export type ToolDefinition = {
  name: string;
  description: string;
  schema: z.ZodType;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  timeoutMs: number;
  idempotent: boolean;
  handler: (rawArgs: unknown, ctx: ToolContext) => Promise<{ ok: boolean; [key: string]: unknown }>;
};

// alegraTools tiene tipos de retorno más específicos por tool (CreateSalesInvoiceData,
// ListBillsData); ToolDefinition solo exige la forma común { ok, ... } que el loop necesita.
const registries: Record<string, Record<string, ToolDefinition>> = {
  alegra: alegraTools as unknown as Record<string, ToolDefinition>,
};

/** Registro de tools del proveedor conectado (`app_connections.provider_key`) — Alegra es el piloto. */
export function getToolRegistry(providerKey: string): Record<string, ToolDefinition> | undefined {
  return registries[providerKey];
}

/**
 * Subconjunto de un registro de tools por nombre — usado para armar el `AgentDefinition` de un
 * agente custom a partir de `custom_agents.enabled_tool_names`
 * (docs/plataforma-multiagente-pivot.md §4). Un nombre en `enabledToolNames` que ya no existe en el
 * registro se ignora silenciosamente en vez de fallar — mismo criterio que
 * docs/conectores-roles-interactividad.md §6 para tools que desaparecen entre la creación del
 * agente y su ejecución.
 */
export function filterToolRegistry(
  registry: Record<string, ToolDefinition>,
  enabledToolNames: readonly string[],
): Record<string, ToolDefinition> {
  const filtered: Record<string, ToolDefinition> = {};
  for (const name of enabledToolNames) {
    const tool = registry[name];
    if (tool) filtered[name] = tool;
  }
  return filtered;
}
