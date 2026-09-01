import type { ToolDefinition } from "@/lib/connectors/registry";
import { registerAgentDefinition } from "@/server/agent/loop";
import { PLATFORM_COPILOT_PROMPT } from "./prompt";
import { platformCopilotTools } from "./tools";

// Registrado en el mismo Map que los agentes de catálogo por conveniencia de implementación (reusa
// toda la infraestructura del loop — persistencia de steps/tool_calls, presupuesto, recuperación)
// pero NO es un agente de catálogo: ningún endpoint/página itera `agentDefinitions` para construir
// el picker de /app/agentes, así que 'platform_copilot' nunca se lista ahí. No requiere
// `agent_config`/activación — su gate vive en la ruta que lo invoca (POST /api/v1/copilot), no
// aquí. Ver docs/plataforma-multiagente-pivot.md §5.
registerAgentDefinition({
  agentType: "platform_copilot",
  systemPrompt: PLATFORM_COPILOT_PROMPT,
  tools: platformCopilotTools as unknown as Record<string, ToolDefinition>,
  maxSteps: 20,
  maxTokensPerCall: 4_096,
  // Sin providerKey: sus tools son internas, nunca llaman rest-client.ts.
});
