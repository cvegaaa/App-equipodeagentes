// Tools internas del copiloto de plataforma — nunca llaman rest-client.ts, nunca aparecen en un
// registro de proveedor (docs/plataforma-multiagente-pivot.md §5). Cada una valida su input con
// zod antes de tocar la base de datos (regla del proyecto: todo argumento de tool se valida, es
// output del modelo, input no confiable).

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getToolRegistry, type ToolContext } from "@/lib/connectors/registry";
import { assertSafeExternalUrl } from "@/lib/connectors/url-guard";
import { db } from "@/lib/db";
import { appConnections, connectorOperations, customAgents } from "@/lib/db/schema";
import { encryptToken } from "@/lib/encryption";
import { writeAuditLog } from "@/server/audit";

type CopilotToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

function actorIdFromInput(input: unknown): string | null {
  if (input && typeof input === "object" && "userId" in input) {
    const value = (input as { userId?: unknown }).userId;
    return typeof value === "string" ? value : null;
  }
  return null;
}

const listConnectedProvidersArgsSchema = z.object({});

export const listConnectedProvidersTool = {
  name: "list_connected_providers" as const,
  description:
    "Lista las conexiones que la organización ya tiene — curadas (kind='platform_rest', como " +
    "Alegra, con tools de código: usa list_provider_tools) y propias (kind='custom_rest', con " +
    "operaciones definidas a mano: usa list_connector_operations). Nunca devuelve el token.",
  schema: listConnectedProvidersArgsSchema,
  inputSchema: { type: "object" as const, properties: {}, required: [] },
  timeoutMs: 5_000,
  idempotent: false,
  async handler(
    _rawArgs: unknown,
    ctx: ToolContext,
  ): Promise<
    CopilotToolResult<
      {
        connectorId: string;
        kind: string;
        providerKey: string | null;
        name: string | null;
        status: string;
      }[]
    >
  > {
    const rows = await db
      .select({
        id: appConnections.id,
        kind: appConnections.kind,
        providerKey: appConnections.providerKey,
        name: appConnections.name,
        status: appConnections.status,
      })
      .from(appConnections)
      .where(
        and(
          eq(appConnections.orgId, ctx.orgId),
          // 'mcp' todavía no soportado por el loop — no se ofrece como opción usable.
          eq(appConnections.kind, "platform_rest"),
        ),
      );
    const customRestRows = await db
      .select({
        id: appConnections.id,
        kind: appConnections.kind,
        providerKey: appConnections.providerKey,
        name: appConnections.name,
        status: appConnections.status,
      })
      .from(appConnections)
      .where(and(eq(appConnections.orgId, ctx.orgId), eq(appConnections.kind, "custom_rest")));

    return {
      ok: true,
      data: [...rows, ...customRestRows].map((row) => ({
        connectorId: row.id,
        kind: row.kind,
        providerKey: row.providerKey,
        name: row.name,
        status: row.status,
      })),
    };
  },
};

const listProviderToolsArgsSchema = z.object({ providerKey: z.string().min(1) });

export const listProviderToolsTool = {
  name: "list_provider_tools" as const,
  description:
    "Lista las tools reales disponibles para un provider_key conectado — nunca inventes una " +
    "capacidad que no aparezca aquí.",
  schema: listProviderToolsArgsSchema,
  inputSchema: {
    type: "object" as const,
    properties: {
      providerKey: {
        type: "string",
        description: "provider_key devuelto por list_connected_providers",
      },
    },
    required: ["providerKey"],
  },
  timeoutMs: 5_000,
  idempotent: false,
  async handler(
    rawArgs: unknown,
    _ctx: ToolContext,
  ): Promise<CopilotToolResult<{ name: string; description: string }[]>> {
    const parsed = listProviderToolsArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "Argumentos inválidos para list_provider_tools",
          details: parsed.error.flatten(),
        },
      };
    }
    const registry = getToolRegistry(parsed.data.providerKey);
    if (!registry) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `No hay tools registradas para '${parsed.data.providerKey}'`,
        },
      };
    }
    return {
      ok: true,
      data: Object.values(registry).map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };
  },
};

const listConnectorOperationsArgsSchema = z.object({ connectorId: z.string().uuid() });

export const listConnectorOperationsTool = {
  name: "list_connector_operations" as const,
  description:
    "Lista las operaciones ya definidas para un conector custom_rest — para saber qué existe " +
    "antes de proponer agregar una nueva con add_connector_operation.",
  schema: listConnectorOperationsArgsSchema,
  inputSchema: {
    type: "object" as const,
    properties: {
      connectorId: { type: "string", description: "Id devuelto por list_connected_providers" },
    },
    required: ["connectorId"],
  },
  timeoutMs: 5_000,
  idempotent: false,
  async handler(
    rawArgs: unknown,
    ctx: ToolContext,
  ): Promise<
    CopilotToolResult<{ name: string; description: string; method: string; path: string }[]>
  > {
    const parsed = listConnectorOperationsArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "validation_error", message: "connectorId inválido" },
      };
    }
    const [connectorRow] = await db
      .select({ id: appConnections.id })
      .from(appConnections)
      .where(
        and(eq(appConnections.id, parsed.data.connectorId), eq(appConnections.orgId, ctx.orgId)),
      );
    if (!connectorRow) {
      return {
        ok: false,
        error: { code: "not_found", message: "connectorId no existe para esta organización" },
      };
    }
    const rows = await db
      .select({
        name: connectorOperations.name,
        description: connectorOperations.description,
        method: connectorOperations.method,
        path: connectorOperations.path,
      })
      .from(connectorOperations)
      .where(eq(connectorOperations.connectionId, parsed.data.connectorId));
    return { ok: true, data: rows };
  },
};

const authTypeSchema = z.enum(["bearer_token", "api_key_header", "basic"]);

const createCustomConnectorArgsSchema = z
  .object({
    name: z.string().min(1).max(200),
    baseUrl: z.string().url(),
    authType: authTypeSchema,
    authHeaderName: z.string().min(1).max(100).optional(),
    token: z.string().min(1),
  })
  .refine((v) => v.authType !== "api_key_header" || !!v.authHeaderName, {
    message: "authHeaderName es requerido cuando authType='api_key_header'",
    path: ["authHeaderName"],
  });

/** Crea un conector `custom_rest` — la organización trae su propia API REST, no una curada por
 * GEIFEM (docs/conectores-roles-interactividad.md §1). `baseUrl` pasa el guard SSRF antes de
 * guardarse (defensa en profundidad — también se revalida en cada ejecución de una tool). */
export const createCustomConnectorTool = {
  name: "create_custom_connector" as const,
  description:
    "Crea una conexión REST propia de la organización hacia un sistema del cliente (no un " +
    "proveedor curado como Alegra). Requiere baseUrl pública (no localhost/IP privada) y una " +
    "credencial que la persona ya tiene a mano.",
  schema: createCustomConnectorArgsSchema,
  inputSchema: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Nombre para identificar la conexión" },
      baseUrl: {
        type: "string",
        description: "URL base de la API, p. ej. https://api.cliente.com",
      },
      authType: { type: "string", description: "'bearer_token' | 'api_key_header' | 'basic'" },
      authHeaderName: { type: "string", description: "Solo si authType='api_key_header'" },
      token: {
        type: "string",
        description: "Credencial — nunca se vuelve a mostrar tras guardarse",
      },
    },
    required: ["name", "baseUrl", "authType", "token"],
  },
  timeoutMs: 5_000,
  idempotent: false,
  async handler(
    rawArgs: unknown,
    ctx: ToolContext,
  ): Promise<CopilotToolResult<{ connectorId: string }>> {
    const parsed = createCustomConnectorArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Argumentos inválidos",
          details: parsed.error.flatten(),
        },
      };
    }
    const args = parsed.data;

    const urlCheck = await assertSafeExternalUrl(args.baseUrl);
    if (!urlCheck.ok) {
      return { ok: false, error: urlCheck.error };
    }

    const actorId = actorIdFromInput(ctx.input);
    if (!actorId) {
      return {
        ok: false,
        error: { code: "unauthorized", message: "No se pudo determinar quién crea el conector" },
      };
    }

    const [created] = await db
      .insert(appConnections)
      .values({
        orgId: ctx.orgId,
        kind: "custom_rest",
        name: args.name,
        baseUrl: args.baseUrl,
        authType: args.authType,
        authHeaderName: args.authType === "api_key_header" ? args.authHeaderName : null,
        encryptedToken: encryptToken(args.token),
        enteredByUserId: actorId,
      })
      .returning({ id: appConnections.id });

    await writeAuditLog({
      actorId,
      orgId: ctx.orgId,
      action: "connector.created",
      targetType: "app_connections",
      targetId: created.id,
      metadata: { kind: "custom_rest", name: args.name, baseUrl: args.baseUrl },
    });

    return { ok: true, data: { connectorId: created.id } };
  },
};

const operationPropertySchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string().max(300).optional(),
});

const addConnectorOperationArgsSchema = z.object({
  connectorId: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, "usa snake_case, empieza con una letra"),
  description: z.string().min(1).max(500),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1).max(300),
  properties: z.record(z.string(), operationPropertySchema).default({}),
  required: z.array(z.string()).default([]),
  idempotent: z.boolean().default(false),
});

/** Define una operación (tool) sobre un conector `custom_rest` — la tool como dato
 * (docs/conectores-roles-interactividad.md §1.2). El nombre debe coincidir con lo que después va
 * en `enabled_tool_names` de `save_custom_agent`. */
export const addConnectorOperationTool = {
  name: "add_connector_operation" as const,
  description:
    "Agrega una operación REST (una tool) a un conector custom_rest ya creado — método, ruta " +
    "relativa a baseUrl (usa :param para parámetros en la ruta) y qué argumentos recibe.",
  schema: addConnectorOperationArgsSchema,
  inputSchema: {
    type: "object" as const,
    properties: {
      connectorId: { type: "string" },
      name: { type: "string", description: "snake_case, es el nombre de la tool para el modelo" },
      description: { type: "string" },
      method: { type: "string", description: "GET | POST | PUT | PATCH | DELETE" },
      path: { type: "string", description: "p. ej. /clientes/:id o /facturas" },
      properties: {
        type: "object",
        description: "mapa nombre → { type: 'string'|'number'|'integer'|'boolean', description? }",
      },
      required: { type: "array", items: { type: "string" } },
      idempotent: { type: "boolean" },
    },
    required: ["connectorId", "name", "description", "method", "path"],
  },
  timeoutMs: 5_000,
  idempotent: false,
  async handler(
    rawArgs: unknown,
    ctx: ToolContext,
  ): Promise<CopilotToolResult<{ operationId: string; name: string }>> {
    const parsed = addConnectorOperationArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Argumentos inválidos",
          details: parsed.error.flatten(),
        },
      };
    }
    const args = parsed.data;

    const [connectorRow] = await db
      .select({ kind: appConnections.kind })
      .from(appConnections)
      .where(and(eq(appConnections.id, args.connectorId), eq(appConnections.orgId, ctx.orgId)));
    if (!connectorRow) {
      return {
        ok: false,
        error: { code: "not_found", message: "connectorId no existe para esta organización" },
      };
    }
    if (connectorRow.kind !== "custom_rest") {
      return {
        ok: false,
        error: {
          code: "unsupported_connector_kind",
          message: "Solo conectores kind='custom_rest' aceptan operaciones definidas a mano",
        },
      };
    }

    const [created] = await db
      .insert(connectorOperations)
      .values({
        connectionId: args.connectorId,
        name: args.name,
        description: args.description,
        method: args.method,
        path: args.path,
        inputSchema: { type: "object", properties: args.properties, required: args.required },
        idempotent: args.idempotent,
        source: "manual",
      })
      .returning({ id: connectorOperations.id });

    return { ok: true, data: { operationId: created.id, name: args.name } };
  },
};

const saveCustomAgentArgsSchema = z.object({
  customAgentId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  systemPrompt: z.string().min(1),
  connectorId: z.string().uuid().optional(),
  enabledToolNames: z.array(z.string()).default([]),
  status: z.enum(["draft", "active"]).default("draft"),
});

export const saveCustomAgentTool = {
  name: "save_custom_agent" as const,
  description:
    "Crea o actualiza (si se pasa customAgentId) la receta de un agente custom. status='active' " +
    "solo si la persona confirmó explícitamente y ya hay un connectorId elegido.",
  schema: saveCustomAgentArgsSchema,
  inputSchema: {
    type: "object" as const,
    properties: {
      customAgentId: {
        type: "string",
        description: "Id a actualizar; omitir para crear uno nuevo",
      },
      name: { type: "string" },
      description: { type: "string" },
      systemPrompt: { type: "string" },
      connectorId: { type: "string", description: "Id devuelto por list_connected_providers" },
      enabledToolNames: { type: "array", items: { type: "string" } },
      status: { type: "string", description: "'draft' o 'active'" },
    },
    required: ["name", "description", "systemPrompt"],
  },
  timeoutMs: 5_000,
  idempotent: true,
  async handler(
    rawArgs: unknown,
    ctx: ToolContext,
  ): Promise<CopilotToolResult<{ customAgentId: string; status: string }>> {
    const parsed = saveCustomAgentArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "Argumentos inválidos para save_custom_agent",
          details: parsed.error.flatten(),
        },
      };
    }
    const args = parsed.data;

    if (args.status === "active" && !args.connectorId) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "Un agente no puede activarse sin connectorId — nunca podría correr.",
        },
      };
    }

    if (args.connectorId) {
      const [connectorRow] = await db
        .select({ kind: appConnections.kind })
        .from(appConnections)
        .where(and(eq(appConnections.id, args.connectorId), eq(appConnections.orgId, ctx.orgId)));
      if (!connectorRow) {
        return {
          ok: false,
          error: { code: "not_found", message: "connectorId no existe para esta organización" },
        };
      }
      if (connectorRow.kind !== "platform_rest" && connectorRow.kind !== "custom_rest") {
        return {
          ok: false,
          error: {
            code: "unsupported_connector_kind",
            message: `Conectores de tipo '${connectorRow.kind}' todavía no están soportados por el loop`,
          },
        };
      }
    }

    const actorId = actorIdFromInput(ctx.input);

    if (args.customAgentId) {
      const [updated] = await db
        .update(customAgents)
        .set({
          name: args.name,
          description: args.description,
          systemPrompt: args.systemPrompt,
          connectorId: args.connectorId,
          enabledToolNames: args.enabledToolNames,
          status: args.status,
          updatedAt: new Date(),
        })
        .where(and(eq(customAgents.id, args.customAgentId), eq(customAgents.orgId, ctx.orgId)))
        .returning({ id: customAgents.id, status: customAgents.status });
      if (!updated) {
        return {
          ok: false,
          error: { code: "not_found", message: "customAgentId no existe para esta organización" },
        };
      }
      await writeAuditLog({
        actorId,
        orgId: ctx.orgId,
        action: "custom_agent.updated",
        targetType: "custom_agents",
        targetId: updated.id,
        metadata: { status: updated.status },
      });
      return { ok: true, data: { customAgentId: updated.id, status: updated.status } };
    }

    const [created] = await db
      .insert(customAgents)
      .values({
        orgId: ctx.orgId,
        createdByUserId: actorId,
        name: args.name,
        description: args.description,
        systemPrompt: args.systemPrompt,
        connectorId: args.connectorId,
        enabledToolNames: args.enabledToolNames,
        status: args.status,
      })
      .returning({ id: customAgents.id, status: customAgents.status });

    await writeAuditLog({
      actorId,
      orgId: ctx.orgId,
      action: "custom_agent.created",
      targetType: "custom_agents",
      targetId: created.id,
      metadata: { status: created.status },
    });
    return { ok: true, data: { customAgentId: created.id, status: created.status } };
  },
};

export const platformCopilotTools = {
  [listConnectedProvidersTool.name]: listConnectedProvidersTool,
  [listProviderToolsTool.name]: listProviderToolsTool,
  [listConnectorOperationsTool.name]: listConnectorOperationsTool,
  [createCustomConnectorTool.name]: createCustomConnectorTool,
  [addConnectorOperationTool.name]: addConnectorOperationTool,
  [saveCustomAgentTool.name]: saveCustomAgentTool,
};
