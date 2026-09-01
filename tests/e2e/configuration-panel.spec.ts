import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfig, appConnections, membership, organization, user } from "@/lib/db/schema";

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

test.describe("UI del panel de configuración", () => {
  // En serie: better-auth aplica rate-limit por IP a /api/auth/sign-up — en paralelo, varios
  // workers agotan el límite entre sí.
  test.describe.configure({ mode: "serial" });

  const orgId = randomUUID();
  const orgSlug = `e2e-config-${randomUUID()}`;
  const adminEmail = `admin-e2e-${randomUUID()}@test.geifem.local`;
  const operatorEmail = `operator-e2e-${randomUUID()}@test.geifem.local`;

  test.beforeAll(async () => {
    const adminId = await signUp(adminEmail, "Admin E2E");
    // 'owner' ("Administrador") es el rol que puede editar conexiones/configuración — 'operator'
    // ("Usuario") es de solo uso, no de gestión (docs/roles-y-workspaces-2026-08.md).
    const ownerId = await signUp(operatorEmail, "Owner E2E");

    await db.insert(organization).values({ id: orgId, name: "Org E2E Config", slug: orgSlug });
    await db.update(user).set({ platformRole: "platform_admin" }).where(eq(user.id, adminId));
    await db
      .insert(membership)
      .values({ userId: ownerId, orgId, role: "owner", acceptedAt: new Date() });
    await db.insert(agentConfig).values({ orgId, enabled: true });
  });

  test.afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, orgId));
  });

  test("un platform_admin crea una organización desde /app/organizaciones", async ({ page }) => {
    await login(page, adminEmail);
    await page.goto("/app/organizaciones");

    const orgName = `Panadería E2E ${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Nombre de la organización").fill(orgName);
    await page.getByRole("button", { name: "Crear organización" }).click();

    await expect(page.getByText(orgName)).toBeVisible();
  });

  test("un owner (administrador) guarda una conexión y el token queda cifrado antes de persistirse", async ({
    page,
  }) => {
    await login(page, operatorEmail);
    await page.goto("/app/conexiones");

    const plaintextToken = `plaintext-token-e2e-${randomUUID()}`;
    await page.getByLabel("URL base").fill("https://api.alegra.com/api/v1");
    await page.getByLabel(/token/i).fill(plaintextToken);
    await page.getByRole("button", { name: "Guardar conexión" }).click();

    await expect(page.getByText("Conexión guardada.")).toBeVisible();

    const [connection] = await db
      .select()
      .from(appConnections)
      .where(eq(appConnections.orgId, orgId));
    expect(connection).toBeDefined();
    expect(connection.encryptedToken).not.toContain(plaintextToken);
  });

  test("un usuario (rol operator, sin ser administrador) ve /app/conexiones de solo lectura", async ({
    page,
  }) => {
    const nonAdminEmail = `usuario-e2e-${randomUUID()}@test.geifem.local`;
    const nonAdminId = await signUp(nonAdminEmail, "Usuario E2E");
    await db
      .insert(membership)
      .values({ userId: nonAdminId, orgId, role: "operator", acceptedAt: new Date() });

    await login(page, nonAdminEmail);
    await page.goto("/app/conexiones");

    await expect(page.getByText(/solo lectura/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar conexión" })).toHaveCount(0);
  });
});
