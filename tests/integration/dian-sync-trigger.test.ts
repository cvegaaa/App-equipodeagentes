import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/dian-sync/route";
import { db } from "@/lib/db";
import {
  agentConfig,
  appConnections,
  dianSyncCursor,
  organization,
  runs,
  user,
} from "@/lib/db/schema";
import { encryptToken } from "@/lib/encryption";
import { env } from "@/lib/env";
import { pollOrgDianSync } from "@/server/jobs/dian-sync-poll";

const org = { id: randomUUID(), slug: `dian-sync-test-${randomUUID()}` };
const seedUser = { id: randomUUID(), email: `dian-sync-test-${randomUUID()}@test.geifem.local` };

beforeAll(async () => {
  await db.insert(organization).values({ id: org.id, name: "Org de prueba", slug: org.slug });
  await db.insert(user).values({ id: seedUser.id, email: seedUser.email, name: "Seed user" });
  await db.insert(agentConfig).values({ orgId: org.id, enabled: true });
  await db.insert(appConnections).values({
    orgId: org.id,
    providerKey: "alegra",
    baseUrl: "https://api.alegra.com/api/v1",
    authType: "basic",
    encryptedToken: encryptToken("admin@geifem.com:fake-token"),
    enteredByUserId: seedUser.id,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(user).where(eq(user.id, seedUser.id));
});

function mockBillsResponse(id: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify([{ id }]), { status: 200 })),
  );
}

describe("GET /api/cron/dian-sync — autorización", () => {
  it("responde 401 sin el CRON_SECRET correcto y no consulta Alegra", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = new NextRequest("http://localhost:3000/api/cron/dian-sync", {
      headers: { authorization: "Bearer secreto-incorrecto" },
    });
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("procesa el poll con el CRON_SECRET correcto", async () => {
    mockBillsResponse(`route-${randomUUID()}`);
    const request = new NextRequest("http://localhost:3000/api/cron/dian-sync", {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });
});

describe("pollOrgDianSync — dedupe por documento", () => {
  it("encola exactamente un run dian_sync para un documento no visto antes", async () => {
    const countBefore = (await db.select().from(runs).where(eq(runs.orgId, org.id))).length;

    const documentId = `doc-${randomUUID()}`;
    mockBillsResponse(documentId);

    const enqueued = await pollOrgDianSync(org.id);
    expect(enqueued).toBe(1);

    const [cursor] = await db.select().from(dianSyncCursor).where(eq(dianSyncCursor.orgId, org.id));
    expect(cursor?.lastExternalDocumentId).toBe(documentId);

    const countAfter = (await db.select().from(runs).where(eq(runs.orgId, org.id))).length;
    expect(countAfter).toBe(countBefore + 1);
  });

  it("invocado dos veces seguidas sobre el mismo documento, encola cero jobs adicionales", async () => {
    const documentId = `doc-repeated-${randomUUID()}`;
    mockBillsResponse(documentId);

    const first = await pollOrgDianSync(org.id);
    expect(first).toBe(1);

    const countAfterFirst = (await db.select().from(runs).where(eq(runs.orgId, org.id))).length;

    mockBillsResponse(documentId); // misma respuesta — mismo documento
    const second = await pollOrgDianSync(org.id);
    expect(second).toBe(0);

    const countAfterSecond = (await db.select().from(runs).where(eq(runs.orgId, org.id))).length;
    expect(countAfterSecond).toBe(countAfterFirst); // cero runs/jobs adicionales
  });
});
