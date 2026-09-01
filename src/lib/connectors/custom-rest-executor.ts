import { z } from "zod";
import { toOperationInputSchema, validateOperationArgs } from "@/lib/connectors/operation-schema";
import type { ToolContext, ToolDefinition } from "@/lib/connectors/registry";
import { createRestClient } from "@/lib/connectors/rest-client";
import { assertSafeExternalUrl } from "@/lib/connectors/url-guard";

export type ConnectorOperationRow = {
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  inputSchema: unknown;
  idempotent: boolean;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Construye una tool ejecutable a partir de una fila `connector_operations` — la tool como dato,
 * no como código curado (docs/conectores-roles-interactividad.md §1.2/§1.3). `baseUrl` se valida
 * contra el guard SSRF en cada ejecución, no solo al guardar el conector — DNS puede cambiar entre
 * medio (docs/conectores-roles-interactividad.md §1.4).
 */
export function buildCustomRestTool(
  operation: ConnectorOperationRow,
  baseUrl: string,
): ToolDefinition {
  const inputSchema = toOperationInputSchema(operation.inputSchema);

  return {
    name: operation.name,
    description: operation.description,
    // Validación real ocurre en `validateOperationArgs` contra `inputSchema` — este `schema` zod
    // solo satisface el tipo común `ToolDefinition`, nunca se usa para validar (a diferencia de
    // las tools de código, acá el esquema es dato, no zod).
    schema: z.unknown(),
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(inputSchema.properties).map(([key, value]) => [
          key,
          { type: value.type, ...(value.description ? { description: value.description } : {}) },
        ]),
      ),
      required: inputSchema.required,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    idempotent: operation.idempotent,
    async handler(rawArgs: unknown, ctx: ToolContext) {
      const validated = validateOperationArgs(inputSchema, rawArgs);
      if (!validated.ok) {
        return { ok: false, error: { code: "validation_error", message: validated.message } };
      }

      const urlCheck = await assertSafeExternalUrl(baseUrl);
      if (!urlCheck.ok) {
        return { ok: false, error: urlCheck.error };
      }

      let path = operation.path;
      const query: string[] = [];
      for (const [key, value] of Object.entries(validated.data)) {
        const placeholder = `:${key}`;
        if (path.includes(placeholder)) {
          path = path.replaceAll(placeholder, encodeURIComponent(String(value)));
        } else if (operation.method === "GET" || operation.method === "DELETE") {
          query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
      }
      const fullPath = query.length > 0 ? `${path}?${query.join("&")}` : path;
      const body =
        operation.method === "GET" || operation.method === "DELETE" ? undefined : validated.data;

      const client = createRestClient(ctx.connection);
      return client.request({
        method: operation.method,
        path: fullPath,
        body,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    },
  };
}
