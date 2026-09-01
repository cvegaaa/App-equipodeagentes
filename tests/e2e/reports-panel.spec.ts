import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { membership, organization, weeklyReport } from "@/lib/db/schema";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "clave-segura-123";

async function signUp(email: string, name: string): Promise<string> {
  const res = await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  const body = await res.json();
  if (!body?.user?.id) {
    throw new Error(
      `signUp falló para ${email}: status=${res.status} body=${JSON.stringify(body)}`,
    );
  }
  return body.user.id as string;
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL(/\/app/);
}

test.describe("Módulo de reportes en el panel", () => {
  test.describe.configure({ mode: "serial" });

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const nonAdminEmail = `viewer-reportes-${randomUUID()}@test.geifem.local`;

  test.beforeAll(async () => {
    await db.insert(organization).values([
      { id: orgAId, name: "Org A Reportes E2E", slug: `e2e-reportes-a-${randomUUID()}` },
      { id: orgBId, name: "Org B Reportes E2E", slug: `e2e-reportes-b-${randomUUID()}` },
    ]);

    const nonAdminId = await signUp(nonAdminEmail, "Viewer Reportes E2E");
    await db
      .insert(membership)
      .values({ userId: nonAdminId, orgId: orgAId, role: "operator", acceptedAt: new Date() });

    await db.insert(weeklyReport).values([
      {
        orgId: orgAId,
        periodStart: "2026-08-03",
        periodEnd: "2026-08-10",
        audience: "client",
        content: "Semana anterior: 2 gestiones completadas.",
        generatedFrom: {},
      },
      {
        orgId: orgAId,
        periodStart: "2026-08-10",
        periodEnd: "2026-08-17",
        audience: "client",
        content: "Semana más reciente: 5 gestiones completadas.",
        generatedFrom: {},
      },
      {
        orgId: orgAId,
        periodStart: "2026-08-10",
        periodEnd: "2026-08-17",
        audience: "operator",
        content: "Detalle interno: 5 runs exitosos, 0 con incidencia.",
        generatedFrom: {},
      },
      // Reporte de la OTRA organización — un usuario sin membresía ahí nunca debe poder verlo.
      {
        orgId: orgBId,
        periodStart: "2026-08-10",
        periodEnd: "2026-08-17",
        audience: "client",
        content: "Reporte de otra organización — no debe ser visible.",
        generatedFrom: {},
      },
    ]);
  });

  test.afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, orgAId));
    await db.delete(organization).where(eq(organization.id, orgBId));
  });

  test("lista los reportes de la organización activa, ordenados por period_start descendente", async ({
    page,
  }) => {
    await login(page, nonAdminEmail);
    await page.goto("/app/reportes");

    const rows = page.locator("a[href^='/app/reportes/']");
    await expect(rows).toHaveCount(2);
    // El más reciente (10/8) aparece antes que el anterior (3/8).
    await expect(rows.first()).toContainText("5 gestiones");
  });

  test("visitar un reporte de otra organización responde 404", async ({ page }) => {
    const [otherOrgReport] = await db
      .select()
      .from(weeklyReport)
      .where(eq(weeklyReport.orgId, orgBId));

    await login(page, nonAdminEmail);
    const response = await page.goto(`/app/reportes/${otherOrgReport.id}`);
    expect(response?.status()).toBe(404);
  });

  test("un usuario (rol operator, no administrador) siempre ve el contenido audience='client' por defecto", async ({
    page,
  }) => {
    const orgAReports = await db.select().from(weeklyReport).where(eq(weeklyReport.orgId, orgAId));
    const operatorRow = orgAReports.find((r) => r.audience === "operator");
    if (!operatorRow) throw new Error("fixture: falta la fila operator");

    await login(page, nonAdminEmail);
    await page.goto(`/app/reportes/${operatorRow.id}`);

    await expect(page.getByText("Vista cliente")).toBeVisible();
    await expect(page.getByText(/Vista interna/)).toHaveCount(0);
    await expect(page.getByText("Detalle interno")).toHaveCount(0);
  });
});
