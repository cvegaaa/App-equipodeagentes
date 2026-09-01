import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { organization, runs, weeklyReport } from "@/lib/db/schema";
import { generateWeeklyReport } from "@/server/reports/weekly-report";

const org = { id: randomUUID(), slug: `weekly-report-test-${randomUUID()}` };
const periodStart = new Date("2026-01-05T00:00:00.000Z"); // lunes

beforeAll(async () => {
  await db.insert(organization).values({ id: org.id, name: "Org de prueba", slug: org.slug });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org.id));
});

async function seedRun(overrides: Partial<typeof runs.$inferInsert>) {
  const [run] = await db
    .insert(runs)
    .values({
      orgId: org.id,
      triggerType: "chat_request",
      status: "succeeded",
      input: {},
      createdAt: new Date(periodStart.getTime() + 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  return run;
}

describe("generateWeeklyReport", () => {
  it("inserta exactamente dos filas (client y operator) para una organización con runs en el periodo", async () => {
    await seedRun({ status: "succeeded" });

    const result = await generateWeeklyReport(org.id, periodStart);
    expect(result.clientReportId).toBeTruthy();
    expect(result.operatorReportId).toBeTruthy();

    const rows = await db.select().from(weeklyReport).where(eq(weeklyReport.orgId, org.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.audience).sort()).toEqual(["client", "operator"]);
  });

  it("falla en el segundo intento para el mismo periodo y organización, sin duplicar filas", async () => {
    await expect(generateWeeklyReport(org.id, periodStart)).rejects.toThrow();

    const rows = await db.select().from(weeklyReport).where(eq(weeklyReport.orgId, org.id));
    expect(rows).toHaveLength(2); // sigue en 2, no se duplicó
  });

  it("incluye un run failed/budget_exceeded en el contenido operator y lo omite del client", async () => {
    const org2 = { id: randomUUID(), slug: `weekly-report-test-2-${randomUUID()}` };
    await db.insert(organization).values({ id: org2.id, name: "Org 2", slug: org2.slug });

    await db.insert(runs).values({
      orgId: org2.id,
      triggerType: "chat_request",
      status: "failed",
      input: {},
      createdAt: new Date(periodStart.getTime() + 24 * 60 * 60 * 1000),
    });

    const result = await generateWeeklyReport(org2.id, periodStart);
    const [clientReport] = await db
      .select()
      .from(weeklyReport)
      .where(eq(weeklyReport.id, result.clientReportId));
    const [operatorReport] = await db
      .select()
      .from(weeklyReport)
      .where(eq(weeklyReport.id, result.operatorReportId));

    expect(operatorReport.content).toContain("status=failed");
    expect(clientReport.content).not.toContain("status=failed");

    await db.delete(organization).where(eq(organization.id, org2.id));
  });
});
