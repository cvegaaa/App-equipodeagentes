import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization, runs, user } from "@/lib/db/schema";

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

test.describe("Panel de observabilidad", () => {
  test.describe.configure({ mode: "serial" });

  const orgId = randomUUID();
  const orgSlug = `e2e-observabilidad-${randomUUID()}`;
  const adminEmail = `admin-obs-e2e-${randomUUID()}@test.geifem.local`;
  const viewerEmail = `viewer-obs-e2e-${randomUUID()}@test.geifem.local`;

  test.beforeAll(async () => {
    const adminId = await signUp(adminEmail, "Admin Observabilidad E2E");
    await signUp(viewerEmail, "Viewer Observabilidad E2E");

    await db
      .insert(organization)
      .values({ id: orgId, name: "Org E2E Observabilidad", slug: orgSlug });
    await db.update(user).set({ platformRole: "platform_admin" }).where(eq(user.id, adminId));

    await db.insert(runs).values([
      { orgId, triggerType: "chat_request", status: "succeeded", endedAt: new Date() },
      { orgId, triggerType: "chat_request", status: "failed", endedAt: new Date() },
    ]);
  });

  test.afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, orgId));
  });

  test("un platform_admin ve la tasa de éxito de los últimos 7 días", async ({ page }) => {
    await login(page, adminEmail);
    await page.goto("/app/observabilidad");

    await expect(page.getByText("Tasa de éxito")).toBeVisible();
    await expect(page.getByText("Org E2E Observabilidad").first()).toBeVisible();
  });

  test("un usuario sin platform_role='platform_admin' recibe 403 en /app/observabilidad", async ({
    page,
  }) => {
    await login(page, viewerEmail);
    const response = await page.goto("/app/observabilidad");

    expect(response?.status()).toBe(403);
  });
});
