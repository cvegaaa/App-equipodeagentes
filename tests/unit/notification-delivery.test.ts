import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { resendSendMock } = vi.hoisted(() => ({ resendSendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: resendSendMock };
  },
}));

import { db } from "@/lib/db";
import { organization, weeklyReport } from "@/lib/db/schema";
import { loadEnv } from "@/lib/env";
import { sendWeeklyReport } from "@/server/reports/send-report";

const org = { id: randomUUID(), slug: `notif-test-${randomUUID()}` };

beforeAll(async () => {
  await db.insert(organization).values({ id: org.id, name: "Org de prueba", slug: org.slug });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org.id));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resendSendMock.mockReset();
});

let periodCounter = 0;

async function seedReport() {
  periodCounter += 1;
  const day = String(periodCounter).padStart(2, "0");
  const [report] = await db
    .insert(weeklyReport)
    .values({
      orgId: org.id,
      periodStart: `2026-02-${day}`,
      periodEnd: `2026-02-${String(periodCounter + 7).padStart(2, "0")}`,
      audience: "client",
      content: "Resumen de prueba",
      generatedFrom: { runIds: [] },
    })
    .returning();
  return report;
}

describe("sendWeeklyReport — correo", () => {
  it("actualiza weekly_report.sent_email_at cuando el envío de correo se completa", async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: "email_1" }, error: null });
    vi.stubGlobal("fetch", vi.fn());

    const report = await seedReport();
    const result = await sendWeeklyReport(report.id, { email: "cliente@test.geifem.local" });
    expect(result.emailSent).toBe(true);

    const [updated] = await db.select().from(weeklyReport).where(eq(weeklyReport.id, report.id));
    expect(updated.sentEmailAt).not.toBeNull();
  });
});

describe("sendWeeklyReport — WhatsApp", () => {
  it("si el envío de WhatsApp falla, no lanza y sent_whatsapp_at permanece nulo", async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: "email_2" }, error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "rechazado" }), { status: 400 })),
    );

    const report = await seedReport();
    await expect(
      sendWeeklyReport(report.id, {
        email: "cliente@test.geifem.local",
        whatsappNumber: "573000000000",
      }),
    ).resolves.toEqual({ emailSent: true, whatsappSent: false });

    const [updated] = await db.select().from(weeklyReport).where(eq(weeklyReport.id, report.id));
    expect(updated.sentWhatsappAt).toBeNull();
  });
});

describe("env — variables de WhatsApp requeridas al arrancar", () => {
  it("falla con un EnvValidationError si WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID faltan", () => {
    const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const originalPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;

    try {
      expect(() => loadEnv()).toThrowError(/WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID/);
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
      process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneId;
    }
  });
});
