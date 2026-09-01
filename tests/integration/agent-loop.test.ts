import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "@/lib/connectors/registry";
import { db } from "@/lib/db";
import {
  appConnections,
  connectorOperations,
  customAgents,
  organization,
  runs,
  steps,
  toolCalls,
  user,
} from "@/lib/db/schema";
import { encryptToken } from "@/lib/encryption";
import type { ModelContentBlock, ModelUsage } from "@/lib/model-gateway";
import { registerAgentDefinition, runAgentLoop } from "@/server/agent/loop";

const usage: ModelUsage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };

function textResponse(text: string) {
  return {
    ok: true as const,
    data: {
      text,
      content: [{ type: "text", text, citations: null }] as ModelContentBlock[],
      stopReason: "end_turn",
      usage,
    },
  };
}

function toolUseResponse(id: string, name: string, input: unknown) {
  return {
    ok: true as const,
    data: {
      text: "",
      content: [
        { type: "tool_use", id, name, input, caller: { type: "direct" } },
      ] as ModelContentBlock[],
      stopReason: "tool_use",
      usage,
    },
  };
}

const writeCalls: string[] = [];

const testWriteTool: ToolDefinition = {
  name: "test.write_thing",
  description: "Tool de prueba que simula un efecto secundario real (crear algo).",
  schema: z.object({ value: z.string() }),
  inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
  timeoutMs: 5_000,
  idempotent: true,
  async handler(_rawArgs, ctx) {
    const [row] = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.idempotencyKey, ctx.idempotencyKey));
    if (!row) {
      throw new Error("tool_calls no fue persistido antes de invocar el handler");
    }
    writeCalls.push(ctx.idempotencyKey);
    return { ok: true, data: { written: true, callCount: writeCalls.length } };
  },
};

const testFailTool: ToolDefinition = {
  name: "test.fail_thing",
  description: "Tool de prueba que siempre lanza.",
  schema: z.object({}),
  inputSchema: { type: "object", properties: {}, required: [] },
  timeoutMs: 5_000,
  idempotent: false,
  async handler() {
    throw new Error("boom — falla intencional de la tool");
  },
};

registerAgentDefinition({
  agentType: "test_agent",
  systemPrompt: "eres un agente de prueba",
  tools: { [testWriteTool.name]: testWriteTool, [testFailTool.name]: testFailTool },
  maxSteps: 20,
  maxTokensPerCall: 100,
  providerKey: "test-provider",
});

registerAgentDefinition({
  agentType: "test_agent_no_connection",
  systemPrompt: "eres un agente de prueba sin conexión configurada",
  tools: { [testWriteTool.name]: testWriteTool },
  maxSteps: 20,
  maxTokensPerCall: 100,
  providerKey: "provider-nunca-conectado",
});

registerAgentDefinition({
  agentType: "test_agent_budget",
  systemPrompt: "eres un agente de prueba con presupuesto chico",
  tools: { [testWriteTool.name]: testWriteTool },
  maxSteps: 2,
  maxTokensPerCall: 100,
  providerKey: "test-provider",
});

const org = { id: randomUUID(), slug: `agent-loop-test-${randomUUID()}` };
const seedUser = { id: randomUUID(), email: `agent-loop-test-${randomUUID()}@test.geifem.local` };

beforeAll(async () => {
  await db.insert(organization).values({ id: org.id, name: "Org de prueba", slug: org.slug });
  await db.insert(user).values({ id: seedUser.id, email: seedUser.email, name: "Seed user" });
  await db.insert(appConnections).values({
    orgId: org.id,
    providerKey: "test-provider",
    baseUrl: "https://example.test",
    authType: "bearer_token",
    encryptedToken: encryptToken("fake-token"),
    enteredByUserId: seedUser.id,
  });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(user).where(eq(user.id, seedUser.id));
});

async function createRun(agentType: string) {
  const [run] = await db
    .insert(runs)
    .values({
      orgId: org.id,
      agentType,
      triggerType: "chat_request",
      status: "queued",
      input: "hola",
    })
    .returning();
  return run;
}

describe("runAgentLoop — persistencia antes de ejecutar", () => {
  it("escribe la fila tool_calls con idempotency_key antes de invocar el handler", async () => {
    const run = await createRun("test_agent");
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("toolu_1", "test.write_thing", { value: "x" }))
      .mockResolvedValueOnce(textResponse("listo"));

    await runAgentLoop(run.id, { sendMessage });

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("succeeded");

    const toolStep = (await db.select().from(steps).where(eq(steps.runId, run.id))).find(
      (s) => s.kind === "tool",
    );
    expect(toolStep?.state).toBe("done");
  });
});

describe("runAgentLoop — una tool que lanza no mata el loop", () => {
  it("registra steps.state='error' y continúa hasta terminar el run", async () => {
    const run = await createRun("test_agent");
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("toolu_2", "test.fail_thing", {}))
      .mockResolvedValueOnce(textResponse("listo, aunque la tool falló"));

    await expect(runAgentLoop(run.id, { sendMessage })).resolves.toBeUndefined();

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("succeeded");

    const toolStep = (await db.select().from(steps).where(eq(steps.runId, run.id))).find(
      (s) => s.kind === "tool",
    );
    expect(toolStep?.state).toBe("error");
  });
});

describe("runAgentLoop — presupuesto de steps", () => {
  it("marca budget_exceeded al alcanzar max_steps, sin exceder max_steps + 1 filas en steps", async () => {
    const run = await createRun("test_agent_budget");
    const sendMessage = vi
      .fn()
      .mockResolvedValue(toolUseResponse("toolu_x", "test.write_thing", { value: "x" }));

    await runAgentLoop(run.id, { sendMessage });

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("budget_exceeded");

    const runSteps = await db.select().from(steps).where(eq(steps.runId, run.id));
    expect(runSteps.length).toBeLessThanOrEqual(3); // maxSteps=2 + 1
  });
});

describe("runAgentLoop — sin conexión configurada para el proveedor", () => {
  it("termina el run como 'failed' en vez de tumbar el proceso worker", async () => {
    const run = await createRun("test_agent_no_connection");
    const sendMessage = vi.fn();

    await expect(runAgentLoop(run.id, { sendMessage })).resolves.toBeUndefined();

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("failed");
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("runAgentLoop — reanudación tras un worker reiniciado", () => {
  it("retoma desde el último step commiteado sin repetir el efecto secundario ya confirmado", async () => {
    const run = await createRun("test_agent");
    const idempotencyKey = `seed-${randomUUID()}`;

    const [priorStep] = await db
      .insert(steps)
      .values({
        runId: run.id,
        ordinal: 0,
        kind: "tool",
        state: "done",
        input: { toolUseId: "toolu_prev", name: "test.write_thing", args: { value: "ya-hecho" } },
        output: { result: { written: true, callCount: 1 } },
      })
      .returning();
    await db.insert(toolCalls).values({
      stepId: priorStep.id,
      toolName: "test.write_thing",
      args: { value: "ya-hecho" },
      idempotencyKey,
      result: { written: true, callCount: 1 },
    });
    await db.update(runs).set({ status: "running" }).where(eq(runs.id, run.id));

    const callsBefore = writeCalls.length;
    const sendMessage = vi.fn().mockResolvedValueOnce(textResponse("retomado, sin repetir nada"));

    await runAgentLoop(run.id, { sendMessage });

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("succeeded");
    expect(writeCalls.length).toBe(callsBefore); // el handler no se volvió a invocar

    const toolCallRows = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.idempotencyKey, idempotencyKey));
    expect(toolCallRows).toHaveLength(1); // exactamente una fila de efecto secundario
  });

  it("resuelve un step interrumpido a mitad de ejecución (tool_calls ya tenía resultado) sin reinvocar la tool", async () => {
    const run = await createRun("test_agent");
    const idempotencyKey = `interrupted-${randomUUID()}`;

    const [priorStep] = await db
      .insert(steps)
      .values({
        runId: run.id,
        ordinal: 0,
        kind: "tool",
        state: "running", // el worker murió antes de marcar este step como 'done'
        input: {
          toolUseId: "toolu_prev2",
          name: "test.write_thing",
          args: { value: "interrumpido" },
        },
      })
      .returning();
    await db.insert(toolCalls).values({
      stepId: priorStep.id,
      toolName: "test.write_thing",
      args: { value: "interrumpido" },
      idempotencyKey,
      result: { written: true, callCount: 99 }, // el handler sí terminó antes del crash
    });
    await db.update(runs).set({ status: "running" }).where(eq(runs.id, run.id));

    const callsBefore = writeCalls.length;
    const sendMessage = vi.fn().mockResolvedValueOnce(textResponse("recuperado"));

    await runAgentLoop(run.id, { sendMessage });

    const [recoveredStep] = await db.select().from(steps).where(eq(steps.id, priorStep.id));
    expect(recoveredStep.state).toBe("done");
    expect(writeCalls.length).toBe(callsBefore); // nunca se reinvocó el handler

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("succeeded");
  });
});

describe("runAgentLoop — agente custom (custom:<id>)", () => {
  it("resuelve la definición desde custom_agents y corre normalmente", async () => {
    const [connection] = await db
      .insert(appConnections)
      .values({
        orgId: org.id,
        kind: "platform_rest",
        // getToolRegistry solo conoce 'alegra' (src/lib/connectors/registry.ts) — cualquier otro
        // provider_key haría fallar la resolución antes de llegar a ejecutar nada.
        providerKey: "alegra",
        baseUrl: "https://api.alegra.test",
        authType: "basic",
        encryptedToken: encryptToken("fake-token"),
        enteredByUserId: seedUser.id,
      })
      .returning();
    const [agentRow] = await db
      .insert(customAgents)
      .values({
        orgId: org.id,
        createdByUserId: seedUser.id,
        name: "Agente de prueba",
        description: "Creado en test",
        systemPrompt: "eres un agente custom de prueba",
        connectorId: connection.id,
        enabledToolNames: [],
        status: "active",
      })
      .returning();

    const run = await createRun(`custom:${agentRow.id}`);
    const sendMessage = vi.fn().mockResolvedValueOnce(textResponse("hola desde el agente custom"));

    await runAgentLoop(run.id, { sendMessage });

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("succeeded");
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ system: "eres un agente custom de prueba" }),
    );
  });

  it("termina 'failed' sin tumbar el worker si el agente custom no existe", async () => {
    const run = await createRun(`custom:${randomUUID()}`);
    const sendMessage = vi.fn();

    await expect(runAgentLoop(run.id, { sendMessage })).resolves.toBeUndefined();

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("failed");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("termina 'failed' si el agente custom pertenece a otra organización", async () => {
    const otherOrg = { id: randomUUID(), slug: `agent-loop-other-${randomUUID()}` };
    await db
      .insert(organization)
      .values({ id: otherOrg.id, name: "Otra org", slug: otherOrg.slug });
    const [agentRow] = await db
      .insert(customAgents)
      .values({
        orgId: otherOrg.id,
        name: "Agente de otra org",
        description: "no debería resolver desde `org`",
        systemPrompt: "no debería usarse",
        status: "active",
        enabledToolNames: [],
      })
      .returning();

    const run = await createRun(`custom:${agentRow.id}`); // creado bajo `org`, no `otherOrg`
    const sendMessage = vi.fn();

    await runAgentLoop(run.id, { sendMessage });

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("failed");
    expect(sendMessage).not.toHaveBeenCalled();

    await db.delete(organization).where(eq(organization.id, otherOrg.id));
  });

  it("termina 'failed' si el agente custom no está activo", async () => {
    const [agentRow] = await db
      .insert(customAgents)
      .values({
        orgId: org.id,
        name: "Agente en borrador",
        description: "todavía no activado",
        systemPrompt: "no debería usarse",
        status: "draft",
        enabledToolNames: [],
      })
      .returning();

    const run = await createRun(`custom:${agentRow.id}`);
    const sendMessage = vi.fn();

    await runAgentLoop(run.id, { sendMessage });

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("failed");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("termina 'failed' si el conector del agente custom es 'mcp' (todavía no soportado)", async () => {
    const [connection] = await db
      .insert(appConnections)
      .values({
        orgId: org.id,
        kind: "mcp",
        baseUrl: "https://mcp.example.test",
        transport: "http",
        authType: "bearer_token",
        encryptedToken: encryptToken("fake-token"),
        enteredByUserId: seedUser.id,
      })
      .returning();
    const [agentRow] = await db
      .insert(customAgents)
      .values({
        orgId: org.id,
        name: "Agente sobre MCP",
        description: "todavía no soportado por el loop",
        systemPrompt: "no debería usarse",
        connectorId: connection.id,
        status: "active",
        enabledToolNames: [],
      })
      .returning();

    const run = await createRun(`custom:${agentRow.id}`);
    const sendMessage = vi.fn();

    await runAgentLoop(run.id, { sendMessage });

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("failed");
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("runAgentLoop — agente custom sobre un conector custom_rest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // IP de TEST-NET-3 (RFC 5737) — literal, nunca ruteable de verdad, así que el guard SSRF la
    // deja pasar (no es privada) sin que este test dependa de una resolución DNS real.
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ejecuta una operación custom_rest de punta a punta y persiste el resultado", async () => {
    const [connection] = await db
      .insert(appConnections)
      .values({
        orgId: org.id,
        kind: "custom_rest",
        name: "API del cliente",
        baseUrl: "https://203.0.113.5",
        authType: "bearer_token",
        encryptedToken: encryptToken("cliente-token"),
        enteredByUserId: seedUser.id,
      })
      .returning();
    const [operation] = await db
      .insert(connectorOperations)
      .values({
        connectionId: connection.id,
        name: "get_order_status",
        description: "Consulta el estado de un pedido",
        method: "GET",
        path: "/orders/:id",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        idempotent: false,
      })
      .returning();
    const [agentRow] = await db
      .insert(customAgents)
      .values({
        orgId: org.id,
        name: "Agente sobre API propia",
        description: "usa una API REST del cliente",
        systemPrompt: "eres un agente sobre la API del cliente",
        connectorId: connection.id,
        status: "active",
        enabledToolNames: ["get_order_status"],
      })
      .returning();

    const run = await createRun(`custom:${agentRow.id}`);
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("toolu_rest", "get_order_status", { id: "42" }))
      .mockResolvedValueOnce(textResponse("el pedido 42 está ok"));

    await runAgentLoop(run.id, { sendMessage });

    const [updated] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(updated.status).toBe("succeeded");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://203.0.113.5/orders/42");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer cliente-token");

    const toolStep = (await db.select().from(steps).where(eq(steps.runId, run.id))).find(
      (s) => s.kind === "tool",
    );
    expect(toolStep?.state).toBe("done");

    await db.delete(connectorOperations).where(eq(connectorOperations.id, operation.id));
  });

  it("nunca ejecuta una tool que no está en enabled_tool_names, aunque exista la operación", async () => {
    const [connection] = await db
      .insert(appConnections)
      .values({
        orgId: org.id,
        kind: "custom_rest",
        name: "API del cliente 2",
        baseUrl: "https://203.0.113.6",
        authType: "bearer_token",
        encryptedToken: encryptToken("cliente-token-2"),
        enteredByUserId: seedUser.id,
      })
      .returning();
    await db.insert(connectorOperations).values({
      connectionId: connection.id,
      name: "delete_everything",
      description: "operación existente pero no habilitada para este agente",
      method: "DELETE",
      path: "/danger",
      inputSchema: { type: "object", properties: {}, required: [] },
      idempotent: false,
    });
    const [agentRow] = await db
      .insert(customAgents)
      .values({
        orgId: org.id,
        name: "Agente con tool no habilitada",
        description: "no debe poder llamar delete_everything",
        systemPrompt: "no debería usarse",
        connectorId: connection.id,
        status: "active",
        enabledToolNames: [], // delete_everything NO está habilitada
      })
      .returning();

    const run = await createRun(`custom:${agentRow.id}`);
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("toolu_danger", "delete_everything", {}))
      .mockResolvedValueOnce(textResponse("listo"));

    await runAgentLoop(run.id, { sendMessage });

    expect(fetchMock).not.toHaveBeenCalled();
    const toolStep = (await db.select().from(steps).where(eq(steps.runId, run.id))).find(
      (s) => s.kind === "tool",
    );
    expect(toolStep?.state).toBe("error");
    expect(toolStep?.error).toContain("desconocida");
  });
});
