import { describe, expect, it } from "vitest";
import {
  assembleSystemPrompt,
  assertAgentEnabled,
  businessRulesSchema,
} from "@/server/agent/aux-contable/definition";
import {
  AUX_CONTABLE_BASE_PROMPT,
  SOPORTE_AUDIT_INSTRUCTION,
} from "@/server/agent/aux-contable/prompt";

const businessRules = businessRulesSchema.parse({ soporte_threshold_cents: 1_000_000 });

describe("assembleSystemPrompt — distinción soporte-audit por trigger_type", () => {
  it("omite la instrucción de auditoría de soporte cuando trigger_type='dian_sync', sin importar el monto", () => {
    const prompt = assembleSystemPrompt({
      triggerType: "dian_sync",
      businessRules,
      documentAmountCents: 999_999_999,
    });
    expect(prompt).not.toContain(SOPORTE_AUDIT_INSTRUCTION);
  });

  it("incluye la instrucción cuando trigger_type='chat_request' y el monto supera el umbral", () => {
    const prompt = assembleSystemPrompt({
      triggerType: "chat_request",
      businessRules,
      documentAmountCents: businessRules.soporte_threshold_cents + 1,
    });
    expect(prompt).toContain(SOPORTE_AUDIT_INSTRUCTION);
  });

  it("omite la instrucción en chat_request cuando el monto no supera el umbral", () => {
    const prompt = assembleSystemPrompt({
      triggerType: "chat_request",
      businessRules,
      documentAmountCents: businessRules.soporte_threshold_cents - 1,
    });
    expect(prompt).not.toContain(SOPORTE_AUDIT_INSTRUCTION);
  });

  it("omite la instrucción en chat_request cuando no se conoce el monto del documento", () => {
    const prompt = assembleSystemPrompt({ triggerType: "chat_request", businessRules });
    expect(prompt).not.toContain(SOPORTE_AUDIT_INSTRUCTION);
  });
});

describe("assembleSystemPrompt — tono y descripción de negocio", () => {
  it("no agrega nada cuando business_rules no trae tone ni business_description", () => {
    const prompt = assembleSystemPrompt({ triggerType: "chat_request", businessRules });
    expect(prompt).not.toContain("Contexto de esta organización");
    expect(prompt).toBe(AUX_CONTABLE_BASE_PROMPT);
  });

  it("inyecta la descripción del negocio y el tono cuando están configurados", () => {
    const rules = businessRulesSchema.parse({
      soporte_threshold_cents: 1_000_000,
      tone: "cercano y directo",
      business_description: "somos una panadería con dos sucursales",
    });
    const prompt = assembleSystemPrompt({ triggerType: "chat_request", businessRules: rules });
    expect(prompt).toContain("somos una panadería con dos sucursales");
    expect(prompt).toContain("cercano y directo");
  });

  it("sigue incluyendo la auditoría de soporte aunque haya tono/descripción configurados", () => {
    const rules = businessRulesSchema.parse({
      soporte_threshold_cents: 1_000_000,
      tone: "formal",
      business_description: "distribuidora de insumos",
    });
    const prompt = assembleSystemPrompt({
      triggerType: "chat_request",
      businessRules: rules,
      documentAmountCents: rules.soporte_threshold_cents + 1,
    });
    expect(prompt).toContain(SOPORTE_AUDIT_INSTRUCTION);
    expect(prompt).toContain("distribuidora de insumos");
  });
});

describe("assertAgentEnabled", () => {
  it("rechaza la creación de un run cuando agent_config.enabled=false", () => {
    const result = assertAgentEnabled({ enabled: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("agent_disabled");
  });

  it("rechaza también cuando no hay agent_config en absoluto para la organización", () => {
    const result = assertAgentEnabled(undefined);
    expect(result.ok).toBe(false);
  });

  it("permite la creación de un run cuando agent_config.enabled=true", () => {
    const result = assertAgentEnabled({ enabled: true });
    expect(result.ok).toBe(true);
  });
});
