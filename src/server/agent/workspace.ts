import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfig, customAgents } from "@/lib/db/schema";

// Único agente de catálogo hoy — cuando se agregue otro (un directorio nuevo bajo
// src/server/agent/<agent_type>/, ver docs/plataforma-multiagente-pivot.md §8), su metadata se
// agrega aquí también. El catálogo sigue siendo código, no una tabla (regla 10 del proyecto).
export const CATALOG_AGENTS: Record<string, { name: string; description: string }> = {
  aux_contable: {
    name: "Aux Contable",
    description: "Clasifica gastos, factura de venta y hace seguimiento de soportes sobre Alegra.",
  },
};

export type AgentWorkspace =
  | {
      kind: "catalog";
      agentType: string;
      name: string;
      description: string;
      enabled: boolean;
    }
  | {
      kind: "custom";
      agentType: string; // "custom:<id>" — lo que espera runs.agent_type / el loop
      id: string;
      name: string;
      description: string;
      status: "draft" | "active" | "archived";
      connectorId: string | null;
      systemPrompt: string;
    };

/**
 * Resuelve el agente detrás del segmento de URL `/app/agentes/[agentType]` — el `agentType` de un
 * agente de catálogo (p. ej. `aux_contable`) o el id bare de un `custom_agents` (nunca
 * `custom:<id>` en la URL — se reconstruye acá, evita el problema de un `:` en un segmento de
 * ruta). `null` si no existe o no pertenece a `orgId` (aislamiento de tenant explícito en el
 * `WHERE`, .claude/rules/db-schema.md).
 */
export async function resolveAgentWorkspace(
  agentTypeParam: string,
  orgId: string,
): Promise<AgentWorkspace | null> {
  const catalogMeta = CATALOG_AGENTS[agentTypeParam];
  if (catalogMeta) {
    const [config] = await db
      .select({ enabled: agentConfig.enabled })
      .from(agentConfig)
      .where(and(eq(agentConfig.orgId, orgId), eq(agentConfig.agentType, agentTypeParam)));
    return {
      kind: "catalog",
      agentType: agentTypeParam,
      name: catalogMeta.name,
      description: catalogMeta.description,
      enabled: config?.enabled ?? false,
    };
  }

  const [row] = await db
    .select()
    .from(customAgents)
    .where(and(eq(customAgents.id, agentTypeParam), eq(customAgents.orgId, orgId)));
  if (!row) return null;

  return {
    kind: "custom",
    agentType: `custom:${row.id}`,
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as "draft" | "active" | "archived",
    connectorId: row.connectorId,
    systemPrompt: row.systemPrompt,
  };
}
