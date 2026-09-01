// Validador de argumentos para `connector_operations.input_schema` — un subconjunto plano de
// JSON Schema (objeto de propiedades primitivas), suficiente para una operación REST típica de un
// sistema de cliente. No se agregó `ajv` (ni ningún conversor) para esto — mismo criterio que
// `providers/alegra/tools.ts` para su `inputSchema` a mano (CLAUDE.md regla 10): el subconjunto
// que necesitamos es chico y una dependencia nueva no se justifica todavía.

export type OperationPropertyType = "string" | "number" | "integer" | "boolean";

export type OperationInputSchema = {
  type: "object";
  properties: Record<string, { type: OperationPropertyType; description?: string }>;
  required: string[];
};

export type OperationValidationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string };

/** Normaliza un `input_schema` guardado como jsonb (tipado `unknown` al leerlo de Postgres) a la
 * forma esperada — nunca confía en la forma sin chequear (es dato, no código). */
export function toOperationInputSchema(raw: unknown): OperationInputSchema {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as { properties?: unknown; required?: unknown };
    const properties: OperationInputSchema["properties"] = {};
    if (obj.properties && typeof obj.properties === "object") {
      for (const [key, value] of Object.entries(obj.properties as Record<string, unknown>)) {
        const type = (value as { type?: unknown } | null)?.type;
        if (type === "string" || type === "number" || type === "integer" || type === "boolean") {
          const description = (value as { description?: unknown }).description;
          properties[key] = {
            type,
            ...(typeof description === "string" ? { description } : {}),
          };
        }
      }
    }
    return {
      type: "object",
      properties,
      required: Array.isArray(obj.required)
        ? obj.required.filter((r) => typeof r === "string")
        : [],
    };
  }
  return { type: "object", properties: {}, required: [] };
}

/** Valida los argumentos que el modelo mandó para una tool `custom_rest` contra su
 * `input_schema` — nunca se ejecuta una llamada REST con argumentos sin validar (regla del
 * proyecto: todo argumento de tool es output del modelo, input no confiable). */
export function validateOperationArgs(
  schema: OperationInputSchema,
  args: unknown,
): OperationValidationResult {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { ok: false, message: "Los argumentos deben ser un objeto" };
  }
  const record = args as Record<string, unknown>;

  for (const key of schema.required) {
    if (!(key in record) || record[key] === undefined) {
      return { ok: false, message: `Falta el campo requerido '${key}'` };
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const propSchema = schema.properties[key];
    if (!propSchema) continue; // campos extra se ignoran, no se rechazan

    const valid =
      (propSchema.type === "string" && typeof value === "string") ||
      (propSchema.type === "boolean" && typeof value === "boolean") ||
      (propSchema.type === "number" && typeof value === "number") ||
      (propSchema.type === "integer" && typeof value === "number" && Number.isInteger(value));
    if (!valid) {
      return { ok: false, message: `El campo '${key}' debe ser de tipo ${propSchema.type}` };
    }
  }

  return { ok: true, data: record };
}
