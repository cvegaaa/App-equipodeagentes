import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { appConnections, auditLog, customAgents, organization, user } from "@/lib/db/schema";
import { encryptToken } from "@/lib/encryption";
import {
  listConnectedProvidersTool,
  listProviderToolsTool,
  saveCustomAgentTool,
} from "@/server/agent/platform-copilot/tools";

const org = { id: randomUUID(), slug: `copilot-tools-test-${randomUUID()}` };
const otherOrg = { id: randomUUID(), slug: `copilot-tools-other-${randomUUID()}` };
const seedUser = {
  id: randomUUID(),
  email: `copilot-tools-test-${randomUUID()}@test.geifem.local`,
};

function ctxFor(orgId: string, userId?: string) {
  return {
    connection: { baseUrl: "", authType: "bearer_token" as const, token: "" },
    idempotencyKey: randomUUID(),
    orgId,
    input: userId ? { message: "hola", userId } : { message: "hola" },
  };
}

beforeAll(async () => {
  await db.insert(organization).values([
    { id: org.id, name: "Org de prueba", slug: org.slug },
    { id: otherOrg.id, name: "Otra org", slug: otherOrg.slug },
  ]);
  await db.insert(user).values({ id: seedUser.id, email: seedUser.email, name: "Seed user" });
});

afterAll(async () => {
  await db.delete(auditLog).where(eq(auditLog.actorId, seedUser.id));
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(organization).where(eq(organization.id, otherOrg.id));
  await db.delete(user).where(eq(user.id, seedUser.id));
});

describe("list_connected_providers", () => {
  it("solo devuelve conectores kind='platform_rest' de la propia organización", async () => {
    const [platformRest] = await db
      .insert(appConnections)
      .values({
        orgId: org.id,
        kind: "platform_rest",
        providerKey: "alegra",
        name: "Alegra",
        baseUrl: "https://api.alegra.test",
        authType: "basic",
        encryptedToken: encryptToken("fake-token"),
        enteredByUserId: seedUser.id,
      })
      .returning();
    await db.insert(appConnections).values({
      orgId: org.id,
      kind: "mcp",
      name: "Un MCP",
      baseUrl: "https://mcp.example.test",
      transport: "http",
      authType: "bearer_token",
      encryptedToken: encryptToken("fake-token"),
      enteredByUserId: seedUser.id,
    });
    await db.insert(appConnections).values({
      orgId: otherOrg.id,
      kind: "platform_rest",
      providerKey: "alegra",
      baseUrl: "https://api.alegra.test",
      authType: "basic",
      encryptedToken: encryptToken("fake-token"),
      enteredByUserId: seedUser.id,
    });

    const result = await listConnectedProvidersTool.handler({}, ctxFor(org.id));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.connectorId).toBe(platformRest.id);
    expect(result.data[0]?.providerKey).toBe("alegra");
  });
});

describe("list_provider_tools", () => {
  it("devuelve las tools reales de un provider_key registrado", async () => {
    const result = await listProviderToolsTool.handler({ providerKey: "alegra" }, ctxFor(org.id));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.some((t) => t.name === "alegra.create_sales_invoice")).toBe(true);
  });

  it("devuelve error tipado para un provider_key sin registro", async () => {
    const result = await listProviderToolsTool.handler(
      { providerKey: "no-existe" },
      ctxFor(org.id),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("not_found");
  });
});

describe("save_custom_agent", () => {
  it("crea un borrador y registra quién lo creó a partir de ctx.input.userId", async () => {
    const result = await saveCustomAgentTool.handler(
      {
        name: "Agente de prueba",
        description: "Creado en test",
        systemPrompt: "eres un agente de prueba",
      },
      ctxFor(org.id, seedUser.id),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.status).toBe("draft");

    const [row] = await db
      .select()
      .from(customAgents)
      .where(eq(customAgents.id, result.data.customAgentId));
    expect(row?.orgId).toBe(org.id);
    expect(row?.createdByUserId).toBe(seedUser.id);
  });

  it("actualiza en vez de duplicar cuando se pasa customAgentId", async () => {
    const created = await saveCustomAgentTool.handler(
      { name: "V1", description: "d", systemPrompt: "p" },
      ctxFor(org.id),
    );
    if (!created.ok) throw new Error("expected ok");

    const updated = await saveCustomAgentTool.handler(
      {
        customAgentId: created.data.customAgentId,
        name: "V2",
        description: "d2",
        systemPrompt: "p2",
      },
      ctxFor(org.id),
    );
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.data.customAgentId).toBe(created.data.customAgentId);

    const rows = await db
      .select()
      .from(customAgents)
      .where(eq(customAgents.id, created.data.customAgentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("V2");
  });

  it("rechaza status='active' sin connectorId", async () => {
    const result = await saveCustomAgentTool.handler(
      { name: "n", description: "d", systemPrompt: "p", status: "active" },
      ctxFor(org.id),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("validation_error");
  });

  it("rechaza un connectorId de otra organización", async () => {
    const [foreignConnector] = await db
      .insert(appConnections)
      .values({
        orgId: otherOrg.id,
        kind: "platform_rest",
        // provider_key único a propósito — otherOrg ya tiene un conector 'alegra' de un test
        // anterior en este archivo (unique(org_id, provider_key)).
        providerKey: `alegra-foreign-${randomUUID()}`,
        baseUrl: "https://api.alegra.test",
        authType: "basic",
        encryptedToken: encryptToken("fake-token"),
        enteredByUserId: seedUser.id,
      })
      .returning();

    const result = await saveCustomAgentTool.handler(
      { name: "n", description: "d", systemPrompt: "p", connectorId: foreignConnector.id },
      ctxFor(org.id),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("not_found");
  });

  it("no puede actualizar un agente custom de otra organización", async () => {
    const [foreignAgent] = await db
      .insert(customAgents)
      .values({
        orgId: otherOrg.id,
        name: "De otra org",
        description: "d",
        systemPrompt: "p",
        enabledToolNames: [],
      })
      .returning();

    const result = await saveCustomAgentTool.handler(
      {
        customAgentId: foreignAgent.id,
        name: "hackeado",
        description: "d",
        systemPrompt: "p",
      },
      ctxFor(org.id),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("not_found");

    const [unchanged] = await db
      .select()
      .from(customAgents)
      .where(and(eq(customAgents.id, foreignAgent.id), eq(customAgents.orgId, otherOrg.id)));
    expect(unchanged?.name).toBe("De otra org");
  });
});
