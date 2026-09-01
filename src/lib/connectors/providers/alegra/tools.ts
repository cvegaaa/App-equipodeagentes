import { z } from "zod";
import {
  createRestClient,
  type RestConnection,
  type RestError,
} from "@/lib/connectors/rest-client";

// Registro tipado de herramientas del agente para el proveedor piloto Alegra, sobre
// rest-client.ts. Endpoints tomados de docs/connector-integration-decision.md (E1-T2):
// POST /invoices (crear factura de venta), GET /bills (detectar gastos/facturas de compra que
// Alegra ya sincronizó desde la DIAN en su propio entorno — este proyecto no habla con la DIAN).

const salesInvoiceItemSchema = z.object({
  id: z.number().int().positive(),
  price: z.number().positive(),
  quantity: z.number().positive(),
});

export const createSalesInvoiceArgsSchema = z.object({
  clientId: z.number().int().positive(),
  items: z.array(salesInvoiceItemSchema).min(1),
  dueDate: z.string().min(1).optional(),
  observations: z.string().max(2000).optional(),
});
export type CreateSalesInvoiceArgs = z.infer<typeof createSalesInvoiceArgsSchema>;

export const listBillsArgsSchema = z.object({
  start: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(30).default(30),
});
export type ListBillsArgs = z.infer<typeof listBillsArgsSchema>;

type ValidationError = { code: "validation_error"; message: string; details: unknown };
type ToolError = ValidationError | RestError;
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolError };

type CreateSalesInvoiceData = { id: number; number: string };
type ListBillsData = unknown[];

// Primera línea de defensa contra doble ejecución dentro del mismo proceso — solo se cachean
// resultados exitosos (un timeout/error no debe bloquear un reintento legítimo). La garantía
// durable es tool_calls.idempotency_key (unique), aplicada por el agent loop (E2) antes de
// ejecutar cualquier tool — ver .claude/rules/alegra-tools.md.
const idempotencyCache = new Map<string, { ok: true; data: CreateSalesInvoiceData }>();

export const createSalesInvoiceTool = {
  name: "alegra.create_sales_invoice" as const,
  description: "Crea una factura de venta en Alegra para un cliente con los items indicados.",
  schema: createSalesInvoiceArgsSchema,
  // JSON Schema para el `tools` de Anthropic — a mano en vez de un conversor zod→JSON Schema
  // (una dependencia nueva no se justifica para 2 tools, CLAUDE.md regla 10). `schema` (zod) de
  // arriba sigue siendo la validación real en runtime.
  inputSchema: {
    type: "object" as const,
    properties: {
      clientId: { type: "integer", description: "Id del cliente en Alegra" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer", description: "Id del item/producto en Alegra" },
            price: { type: "number" },
            quantity: { type: "number" },
          },
          required: ["id", "price", "quantity"],
        },
      },
      dueDate: { type: "string", description: "Fecha de vencimiento ISO 8601, opcional" },
      observations: { type: "string" },
    },
    required: ["clientId", "items"],
  },
  timeoutMs: 10_000,
  idempotent: true,
  async handler(
    rawArgs: unknown,
    ctx: { connection: RestConnection; idempotencyKey: string },
  ): Promise<ToolResult<CreateSalesInvoiceData>> {
    const parsed = createSalesInvoiceArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "Argumentos inválidos para alegra.create_sales_invoice",
          details: parsed.error.flatten(),
        },
      };
    }

    const cached = idempotencyCache.get(ctx.idempotencyKey);
    if (cached) return cached;

    const client = createRestClient(ctx.connection);
    const result = await client.request<CreateSalesInvoiceData>({
      method: "POST",
      path: "/invoices",
      body: {
        client: { id: parsed.data.clientId },
        items: parsed.data.items,
        dueDate: parsed.data.dueDate,
        observations: parsed.data.observations,
      },
      timeoutMs: createSalesInvoiceTool.timeoutMs,
    });

    if (result.ok) {
      idempotencyCache.set(ctx.idempotencyKey, result);
    }
    return result;
  },
};

export const listBillsTool = {
  name: "alegra.list_bills" as const,
  description:
    "Lista los gastos/facturas de compra que Alegra ya sincronizó desde la DIAN en su propio entorno.",
  schema: listBillsArgsSchema,
  inputSchema: {
    type: "object" as const,
    properties: {
      start: { type: "integer", description: "Offset de paginación, 0-based" },
      limit: { type: "integer", description: "Máximo de resultados, hasta 30" },
    },
    required: [],
  },
  timeoutMs: 10_000,
  idempotent: false,
  async handler(
    rawArgs: unknown,
    ctx: { connection: RestConnection },
  ): Promise<ToolResult<ListBillsData>> {
    const parsed = listBillsArgsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "Argumentos inválidos para alegra.list_bills",
          details: parsed.error.flatten(),
        },
      };
    }

    const client = createRestClient(ctx.connection);
    return client.request<ListBillsData>({
      method: "GET",
      path: `/bills?start=${parsed.data.start}&limit=${parsed.data.limit}`,
      timeoutMs: listBillsTool.timeoutMs,
    });
  },
};

export const alegraTools = {
  [createSalesInvoiceTool.name]: createSalesInvoiceTool,
  [listBillsTool.name]: listBillsTool,
};
