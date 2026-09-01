import { createHash } from "node:crypto";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  buildCustomRestTool,
  type ConnectorOperationRow,
} from "@/lib/connectors/custom-rest-executor";
import {
  filterToolRegistry,
  getToolRegistry,
  type ToolDefinition,
} from "@/lib/connectors/registry";
import type { RestConnection } from "@/lib/connectors/rest-client";
import { db } from "@/lib/db";
import {
  appConnections,
  connectorOperations,
  customAgents,
  runs,
  steps,
  toolCalls,
} from "@/lib/db/schema";
import { decryptToken } from "@/lib/encryption";
import { type ModelMessage, sendMessage as sendMessageDefault } from "@/lib/model-gateway";

const CUSTOM_AGENT_PREFIX = "custom:";
const enabledToolNamesSchema = z.array(z.string()).catch([]);

export type SystemPromptContext = { orgId: string; triggerType: string; input: unknown };

export type AgentDefinition = {
  agentType: string;
  /**
   * String fijo, o una función resuelta una vez al inicio del run — necesaria para agentes cuyo
   * prompt depende de `trigger_type`/`business_rules` de la organización (p. ej. la distinción
   * soporte-audit del Aux Contable, ver `src/server/agent/aux-contable/definition.ts`).
   */
  systemPrompt: string | ((ctx: SystemPromptContext) => string | Promise<string>);
  tools: Record<string, ToolDefinition>;
  maxSteps: number;
  maxTokensPerCall: number;
  /**
   * `app_connections.provider_key` que este agente usa, p. ej. 'alegra' — solo para conectores
   * `kind='platform_rest'` (la conexión se busca por org+provider_key, hay a lo sumo una por
   * organización). Ausente para un agente sin proveedor externo (p. ej. el copiloto de
   * plataforma) o cuando se usa `connectorId` en su lugar.
   */
  providerKey?: string;
  /**
   * `app_connections.id` exacto — para conectores `custom_rest`/`mcp`, que no tienen
   * `provider_key` y de los que una organización puede tener varios (se elige por fila, no por
   * nombre de proveedor). `providerKey` y `connectorId` son mutuamente excluyentes; si ambos
   * faltan, el agente no tiene proveedor externo.
   */
  connectorId?: string;
};

const agentDefinitions = new Map<string, AgentDefinition>();

/** Llamado por cada módulo `agent/<tipo>/definition.ts` al importarse (registro por efecto). */
export function registerAgentDefinition(definition: AgentDefinition): void {
  agentDefinitions.set(definition.agentType, definition);
}

/**
 * Resuelve un `AgentDefinition` — de catálogo (registrado en código, `agentDefinitions`) o custom
 * (`custom:<custom_agents.id>`, construido en memoria a partir de datos —
 * docs/plataforma-multiagente-pivot.md §4). `orgId` nunca es opcional: un agente custom pertenece a
 * una organización y la fila se busca con ese filtro en el `WHERE`, nunca se confía en el `id` solo
 * (.claude/rules/db-schema.md — toda query con dueño de tenant lleva `org_id` explícito).
 */
async function resolveAgentDefinition(agentType: string, orgId: string): Promise<AgentDefinition> {
  if (agentType.startsWith(CUSTOM_AGENT_PREFIX)) {
    return resolveCustomAgentDefinition(agentType.slice(CUSTOM_AGENT_PREFIX.length), orgId);
  }
  const definition = agentDefinitions.get(agentType);
  if (!definition) {
    throw new Error(`No hay AgentDefinition registrada para agentType='${agentType}'`);
  }
  return definition;
}

async function resolveCustomAgentDefinition(
  customAgentId: string,
  orgId: string,
): Promise<AgentDefinition> {
  const [agentRow] = await db
    .select()
    .from(customAgents)
    .where(and(eq(customAgents.id, customAgentId), eq(customAgents.orgId, orgId)));
  if (!agentRow) {
    throw new Error(`Agente custom '${customAgentId}' no existe para esta organización`);
  }
  if (agentRow.status !== "active") {
    throw new Error(
      `Agente custom '${agentRow.name}' no está activo (status='${agentRow.status}')`,
    );
  }
  if (!agentRow.connectorId) {
    throw new Error(`Agente custom '${agentRow.name}' no tiene un conector configurado`);
  }

  const [connectorRow] = await db
    .select()
    .from(appConnections)
    .where(and(eq(appConnections.id, agentRow.connectorId), eq(appConnections.orgId, orgId)));
  if (!connectorRow) {
    throw new Error(
      `Conector del agente custom '${agentRow.name}' no existe para esta organización`,
    );
  }
  const enabledToolNames = enabledToolNamesSchema.parse(agentRow.enabledToolNames);

  if (connectorRow.kind === "platform_rest") {
    if (!connectorRow.providerKey) {
      throw new Error(`Conector platform_rest de '${agentRow.name}' no tiene provider_key`);
    }
    const fullRegistry = getToolRegistry(connectorRow.providerKey);
    if (!fullRegistry) {
      throw new Error(`No hay registro de tools para provider_key='${connectorRow.providerKey}'`);
    }
    return {
      agentType: `${CUSTOM_AGENT_PREFIX}${agentRow.id}`,
      systemPrompt: agentRow.systemPrompt,
      tools: filterToolRegistry(fullRegistry, enabledToolNames),
      maxSteps: 20,
      maxTokensPerCall: 4_096,
      providerKey: connectorRow.providerKey,
    };
  }

  if (connectorRow.kind === "custom_rest") {
    const operationRows = await db
      .select()
      .from(connectorOperations)
      .where(eq(connectorOperations.connectionId, connectorRow.id));
    const enabledSet = new Set(enabledToolNames);
    const tools: Record<string, ToolDefinition> = {};
    for (const operation of operationRows) {
      if (!enabledSet.has(operation.name)) continue; // no habilitada — se ignora, no falla el run
      tools[operation.name] = buildCustomRestTool(
        { ...operation, method: operation.method as ConnectorOperationRow["method"] },
        connectorRow.baseUrl,
      );
    }
    return {
      agentType: `${CUSTOM_AGENT_PREFIX}${agentRow.id}`,
      systemPrompt: agentRow.systemPrompt,
      tools,
      maxSteps: 20,
      maxTokensPerCall: 4_096,
      connectorId: connectorRow.id,
    };
  }

  // 'mcp' todavía necesita su propio cliente de protocolo (docs/conectores-roles-interactividad.md
  // §1.3) — no construido en esta pasada.
  throw new Error(
    `Agente custom '${agentRow.name}' usa un conector de tipo '${connectorRow.kind}', ` +
      "todavía no soportado por el loop",
  );
}

async function loadDecryptedConnection(
  orgId: string,
  providerKey: string,
): Promise<RestConnection> {
  const [row] = await db
    .select()
    .from(appConnections)
    .where(and(eq(appConnections.orgId, orgId), eq(appConnections.providerKey, providerKey)));
  if (!row) {
    throw new Error(`No hay app_connections para org=${orgId} provider_key=${providerKey}`);
  }
  return {
    baseUrl: row.baseUrl,
    authType: row.authType as RestConnection["authType"],
    authHeaderName: row.authHeaderName,
    token: decryptToken(row.encryptedToken),
  };
}

/** Igual que `loadDecryptedConnection`, pero por `id` exacto — para `custom_rest`/`mcp`, donde no
 * hay un `provider_key` global y una organización puede tener varios conectores del mismo tipo. */
async function loadDecryptedConnectionById(
  connectorId: string,
  orgId: string,
): Promise<RestConnection> {
  const [row] = await db
    .select()
    .from(appConnections)
    .where(and(eq(appConnections.id, connectorId), eq(appConnections.orgId, orgId)));
  if (!row) {
    throw new Error(`Conector ${connectorId} no existe para esta organización`);
  }
  return {
    baseUrl: row.baseUrl,
    authType: row.authType as RestConnection["authType"],
    authHeaderName: row.authHeaderName,
    token: decryptToken(row.encryptedToken),
  };
}

function makeIdempotencyKey(
  runId: string,
  ordinal: number,
  toolName: string,
  args: unknown,
): string {
  return createHash("sha256")
    .update(`${runId}:${ordinal}:${toolName}:${JSON.stringify(args)}`)
    .digest("hex");
}

type StepRow = typeof steps.$inferSelect;

/**
 * El primer turno del usuario. `run.input` casi siempre es un objeto (`{ message, ... }` —
 * `userId`, `replyChannel`/`replyTo` para canales externos, etc.), nunca solo el texto — el modelo
 * ve el campo `message`, no el objeto entero serializado (los demás campos son metadata de la
 * plataforma, no algo que el usuario escribió).
 */
function extractUserText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "message" in input) {
    const message = (input as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return JSON.stringify(input);
}

function reconstructMessages(input: unknown, existingSteps: StepRow[]): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: "user", content: extractUserText(input) }];
  for (const step of existingSteps) {
    if (step.kind === "model" && step.state === "done") {
      const output = step.output as { content: ContentBlockParam[] } | null;
      if (output?.content) messages.push({ role: "assistant", content: output.content });
      continue;
    }
    if (step.kind === "tool") {
      const input_ = step.input as { toolUseId: string } | null;
      if (!input_) continue;
      const output = step.output as { result: unknown } | null;
      const content =
        step.state === "done" ? JSON.stringify(output?.result ?? null) : (step.error ?? "error");
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: input_.toolUseId,
            content,
            is_error: step.state !== "done",
          },
        ],
      });
    }
  }
  return messages;
}

/**
 * Resuelve un step 'tool' que quedó en state='running' de un intento anterior (el worker murió
 * entre persistir tool_calls y confirmar el resultado). Nunca reinvoca el handler — solo
 * determina, a partir de lo ya commiteado, si el efecto secundario se confirmó o no.
 */
async function recoverInterruptedStep(step: StepRow): Promise<void> {
  const [toolCallRow] = await db.select().from(toolCalls).where(eq(toolCalls.stepId, step.id));
  if (toolCallRow?.result != null) {
    await db
      .update(steps)
      .set({ state: "done", output: { result: toolCallRow.result } })
      .where(eq(steps.id, step.id));
    return;
  }
  const message =
    "Ejecución interrumpida (worker reiniciado) — resultado no confirmado, no se reintenta " +
    "automáticamente para evitar un efecto duplicado.";
  if (toolCallRow) {
    await db.update(toolCalls).set({ error: message }).where(eq(toolCalls.id, toolCallRow.id));
  }
  await db.update(steps).set({ state: "error", error: message }).where(eq(steps.id, step.id));
}

type LoopDeps = {
  sendMessage: typeof sendMessageDefault;
  loadConnection: typeof loadDecryptedConnection;
  loadConnectionById: typeof loadDecryptedConnectionById;
};

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "budget_exceeded"]);

/** Ejecuta un run existente hasta un estado terminal, persistiendo cada step antes de actuar. */
export async function runAgentLoop(
  runId: string,
  overrides: Partial<LoopDeps> = {},
): Promise<void> {
  const send = overrides.sendMessage ?? sendMessageDefault;
  const loadConnection = overrides.loadConnection ?? loadDecryptedConnection;
  const loadConnectionById = overrides.loadConnectionById ?? loadDecryptedConnectionById;

  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error(`Run ${runId} no existe`);
  if (TERMINAL_STATUSES.has(run.status)) return;

  if (run.status === "queued") {
    await db
      .update(runs)
      .set({ status: "running", startedAt: new Date(), heartbeatAt: new Date() })
      .where(eq(runs.id, run.id));
  }

  let existingSteps = await db
    .select()
    .from(steps)
    .where(eq(steps.runId, run.id))
    .orderBy(asc(steps.ordinal));
  const lastStep = existingSteps.at(-1);
  if (lastStep?.kind === "tool" && lastStep.state === "running") {
    await recoverInterruptedStep(lastStep);
    existingSteps = await db
      .select()
      .from(steps)
      .where(eq(steps.runId, run.id))
      .orderBy(asc(steps.ordinal));
  }

  const messages = reconstructMessages(run.input, existingSteps);
  let ordinal = existingSteps.length;

  let definition: AgentDefinition;
  try {
    definition = await resolveAgentDefinition(run.agentType, run.orgId);
  } catch (error) {
    // agentType desconocido, agente custom borrado/no activo/sin conector: fallo esperable del
    // run, no un bug del worker — termina limpio en vez de tumbar el proceso (mismo criterio que
    // el catch de conexión de abajo).
    const message = error instanceof Error ? error.message : String(error);
    await db
      .insert(steps)
      .values({ runId: run.id, ordinal, kind: "model", state: "error", error: message });
    await db.update(runs).set({ status: "failed", endedAt: new Date() }).where(eq(runs.id, run.id));
    return;
  }

  let connection: RestConnection;
  if (definition.providerKey || definition.connectorId) {
    try {
      connection = definition.connectorId
        ? await loadConnectionById(definition.connectorId, run.orgId)
        : await loadConnection(run.orgId, definition.providerKey as string);
    } catch (error) {
      // Sin conexión configurada (p. ej. Alegra nunca se conectó desde /app/conexiones) es un
      // fallo esperable del run, no un bug del worker — termina limpio en vez de tumbar el proceso.
      const message = error instanceof Error ? error.message : String(error);
      await db
        .insert(steps)
        .values({ runId: run.id, ordinal, kind: "model", state: "error", error: message });
      await db
        .update(runs)
        .set({ status: "failed", endedAt: new Date() })
        .where(eq(runs.id, run.id));
      return;
    }
  } else {
    // Agente sin proveedor externo (p. ej. el copiloto de plataforma) — sus tools nunca llaman
    // rest-client.ts, este valor nunca se lee.
    connection = { baseUrl: "", authType: "bearer_token", token: "" };
  }

  const tools = Object.values(definition.tools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
  const systemPrompt =
    typeof definition.systemPrompt === "function"
      ? await definition.systemPrompt({
          orgId: run.orgId,
          triggerType: run.triggerType,
          input: run.input,
        })
      : definition.systemPrompt;

  while (true) {
    if (ordinal >= definition.maxSteps) {
      await db
        .update(runs)
        .set({ status: "budget_exceeded", endedAt: new Date() })
        .where(eq(runs.id, run.id));
      return;
    }

    await db.update(runs).set({ heartbeatAt: new Date() }).where(eq(runs.id, run.id));

    const modelResult = await send({
      system: systemPrompt,
      messages,
      maxTokens: definition.maxTokensPerCall,
      tools,
    });

    if (!modelResult.ok) {
      await db.insert(steps).values({
        runId: run.id,
        ordinal,
        kind: "model",
        state: "error",
        error: modelResult.error.message,
      });
      await db
        .update(runs)
        .set({ status: "failed", endedAt: new Date() })
        .where(eq(runs.id, run.id));
      return;
    }

    await db.insert(steps).values({
      runId: run.id,
      ordinal,
      kind: "model",
      state: "done",
      output: { content: modelResult.data.content },
    });
    messages.push({
      role: "assistant",
      content: modelResult.data.content as unknown as ContentBlockParam[],
    });
    ordinal += 1;

    const toolUse = modelResult.data.content.find((block) => block.type === "tool_use");
    if (!toolUse) {
      await db
        .update(runs)
        .set({ status: "succeeded", endedAt: new Date(), result: { text: modelResult.data.text } })
        .where(eq(runs.id, run.id));
      return;
    }

    if (ordinal >= definition.maxSteps) {
      await db
        .update(runs)
        .set({ status: "budget_exceeded", endedAt: new Date() })
        .where(eq(runs.id, run.id));
      return;
    }

    const tool = definition.tools[toolUse.name];
    if (!tool) {
      const message = `Tool desconocida: ${toolUse.name}`;
      await db.insert(steps).values({
        runId: run.id,
        ordinal,
        kind: "tool",
        state: "error",
        input: { toolUseId: toolUse.id, name: toolUse.name, args: toolUse.input },
        error: message,
      });
      messages.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: toolUse.id, content: message, is_error: true },
        ],
      });
      ordinal += 1;
      continue;
    }

    const idempotencyKey = makeIdempotencyKey(run.id, ordinal, toolUse.name, toolUse.input);

    // Persiste ANTES de ejecutar — invariante central (.claude/rules/agent-loop.md).
    const [stepRow] = await db
      .insert(steps)
      .values({
        runId: run.id,
        ordinal,
        kind: "tool",
        state: "running",
        input: { toolUseId: toolUse.id, name: toolUse.name, args: toolUse.input },
      })
      .returning();
    await db.insert(toolCalls).values({
      stepId: stepRow.id,
      toolName: toolUse.name,
      args: toolUse.input as object,
      idempotencyKey,
    });

    let toolResult: { ok: boolean; data?: unknown; error?: unknown };
    try {
      toolResult = await tool.handler(toolUse.input, {
        connection,
        idempotencyKey,
        orgId: run.orgId,
        input: run.input,
      });
    } catch (error) {
      toolResult = {
        ok: false,
        error: {
          code: "tool_threw",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    await db
      .update(toolCalls)
      .set({
        result: toolResult.ok ? ((toolResult.data as object | undefined) ?? null) : null,
        error: toolResult.ok ? null : JSON.stringify(toolResult.error),
      })
      .where(eq(toolCalls.idempotencyKey, idempotencyKey));

    await db
      .update(steps)
      .set({
        state: toolResult.ok ? "done" : "error",
        output: toolResult.ok ? { result: toolResult.data } : null,
        error: toolResult.ok ? null : JSON.stringify(toolResult.error),
      })
      .where(eq(steps.id, stepRow.id));

    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(toolResult.ok ? toolResult.data : toolResult.error),
          is_error: !toolResult.ok,
        },
      ],
    });
    ordinal += 1;
  }
}
