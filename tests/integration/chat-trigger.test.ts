import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: getSessionMock } } }));

import { POST } from "@/app/api/v1/chat/route";
import { db } from "@/lib/db";
import { agentConfig, membership, organization, runs, user } from "@/lib/db/schema";

const org = { id: randomUUID(), slug: `chat-trigger-test-${randomUUID()}` };
const operatorUser = { id: randomUUID(), email: `operator-${randomUUID()}@test.geifem.local` };
const outsiderUser = { id: randomUUID(), email: `outsider-${randomUUID()}@test.geifem.local` };

beforeAll(async () => {
  await db.insert(organization).values({ id: org.id, name: "Org de prueba", slug: org.slug });
  await db.insert(user).values([
    { id: operatorUser.id, email: operatorUser.email, name: "Usuario" },
    { id: outsiderUser.id, email: outsiderUser.email, name: "Outsider" },
  ]);
  // 'operator' ("Usuario") es hoy el rol mínimo para chatear — cualquier miembro aceptado puede
  // usar un agente ya activo (docs/roles-y-workspaces-2026-08.md), no solo un 'owner'.
  await db
    .insert(membership)
    .values([{ userId: operatorUser.id, orgId: org.id, role: "operator", acceptedAt: new Date() }]);
  await db.insert(agentConfig).values({ orgId: org.id, enabled: true });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(user).where(eq(user.id, operatorUser.id));
  await db.delete(user).where(eq(user.id, outsiderUser.id));
});

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/chat", () => {
  it("responde 202 con { ok: true, data: { runId, status: 'queued' } } para un operator, sin esperar al worker", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: operatorUser.id } });

    const response = await POST(makeRequest({ message: "hola, genera un reporte" }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("queued");
    expect(typeof body.data.runId).toBe("string");
  });

  it("repetir el mismo Idempotency-Key devuelve el mismo runId sin encolar un job adicional", async () => {
    const idempotencyKey = `idem-${randomUUID()}`;
    getSessionMock.mockResolvedValueOnce({ user: { id: operatorUser.id } });
    const first = await POST(
      makeRequest({ message: "primera vez" }, { "idempotency-key": idempotencyKey }),
    );
    const firstBody = await first.json();

    getSessionMock.mockResolvedValueOnce({ user: { id: operatorUser.id } });
    const second = await POST(
      makeRequest({ message: "primera vez" }, { "idempotency-key": idempotencyKey }),
    );
    const secondBody = await second.json();

    expect(secondBody.data.runId).toBe(firstBody.data.runId);

    const matchingRuns = await db
      .select()
      .from(runs)
      .where(eq(runs.idempotencyKey, idempotencyKey));
    expect(matchingRuns).toHaveLength(1);
  });

  it("responde 422 con code 'validation_error' si message está vacío", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: operatorUser.id } });

    const response = await POST(makeRequest({ message: "" }));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("validation_error");
  });

  it("responde 404 si quien invoca no es miembro de la organización pedida", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: outsiderUser.id } });

    const response = await POST(makeRequest({ message: "quiero una factura", orgId: org.id }));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });
});
