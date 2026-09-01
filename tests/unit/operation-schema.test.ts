import { describe, expect, it } from "vitest";
import { toOperationInputSchema, validateOperationArgs } from "@/lib/connectors/operation-schema";

describe("toOperationInputSchema", () => {
  it("normaliza un jsonb con properties/required válidos", () => {
    const schema = toOperationInputSchema({
      type: "object",
      properties: { orderId: { type: "string", description: "id del pedido" } },
      required: ["orderId"],
    });
    expect(schema).toEqual({
      type: "object",
      properties: { orderId: { type: "string", description: "id del pedido" } },
      required: ["orderId"],
    });
  });

  it("ignora propiedades con un type desconocido en vez de fallar", () => {
    const schema = toOperationInputSchema({
      properties: { x: { type: "array" }, y: { type: "string" } },
      required: [],
    });
    expect(schema.properties).toEqual({ y: { type: "string" } });
  });

  it("devuelve un esquema vacío para basura", () => {
    expect(toOperationInputSchema(null)).toEqual({ type: "object", properties: {}, required: [] });
    expect(toOperationInputSchema("nope")).toEqual({
      type: "object",
      properties: {},
      required: [],
    });
  });
});

describe("validateOperationArgs", () => {
  const schema = toOperationInputSchema({
    properties: {
      orderId: { type: "string" },
      amount: { type: "number" },
      count: { type: "integer" },
      urgent: { type: "boolean" },
    },
    required: ["orderId"],
  });

  it("acepta argumentos válidos", () => {
    const result = validateOperationArgs(schema, {
      orderId: "abc",
      amount: 10.5,
      count: 3,
      urgent: true,
    });
    expect(result.ok).toBe(true);
  });

  it("rechaza cuando falta un campo requerido", () => {
    const result = validateOperationArgs(schema, { amount: 10 });
    expect(result.ok).toBe(false);
  });

  it("rechaza un tipo incorrecto", () => {
    const result = validateOperationArgs(schema, { orderId: 123 });
    expect(result.ok).toBe(false);
  });

  it("rechaza integer cuando el número no es entero", () => {
    const result = validateOperationArgs(schema, { orderId: "x", count: 1.5 });
    expect(result.ok).toBe(false);
  });

  it("ignora campos extra en vez de rechazarlos", () => {
    const result = validateOperationArgs(schema, { orderId: "x", extra: "lo-que-sea" });
    expect(result.ok).toBe(true);
  });

  it("rechaza argumentos que no son un objeto", () => {
    expect(validateOperationArgs(schema, "no-es-objeto").ok).toBe(false);
    expect(validateOperationArgs(schema, null).ok).toBe(false);
    expect(validateOperationArgs(schema, ["orderId"]).ok).toBe(false);
  });
});
