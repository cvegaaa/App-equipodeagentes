import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: getSessionMock } } }));
// Las server actions (a diferencia de los route handlers) llaman next/headers directo — fuera de
// un request real de Next.js eso lanza; se stubea igual que @/lib/auth para poder invocarlas acá.
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { toggleOrganizationStatusAction } from "@/app/app/organizaciones/actions";
import { toggleSuperadminAction } from "@/app/app/plataforma/usuarios/actions";
import { db } from "@/lib/db";
import { auditLog, organization, user } from "@/lib/db/schema";
import { assertOrgActive } from "@/server/org-status";

const superadmin = { id: randomUUID(), email: `superadmin-${randomUUID()}@test.geifem.local` };
const otherAdmin = { id: randomUUID(), email: `other-admin-${randomUUID()}@test.geifem.local` };
const regularUser = { id: randomUUID(), email: `regular-${randomUUID()}@test.geifem.local` };
const org = { id: randomUUID(), slug: `platform-admin-test-${randomUUID()}` };

beforeAll(async () => {
  await db.insert(user).values([
    {
      id: superadmin.id,
      email: superadmin.email,
      name: "Superadmin",
      platformRole: "platform_admin",
    },
    {
      id: otherAdmin.id,
      email: otherAdmin.email,
      name: "Otro admin",
      platformRole: "platform_admin",
    },
    { id: regularUser.id, email: regularUser.email, name: "Regular" },
  ]);
  await db.insert(organization).values({ id: org.id, name: "Org de prueba", slug: org.slug });
});

afterAll(async () => {
  await db.delete(auditLog).where(eq(auditLog.actorId, superadmin.id));
  await db.delete(user).where(eq(user.id, superadmin.id));
  await db.delete(user).where(eq(user.id, otherAdmin.id));
  await db.delete(user).where(eq(user.id, regularUser.id));
  await db.delete(organization).where(eq(organization.id, org.id));
});

describe("toggleSuperadminAction", () => {
  it("un no-superadmin no puede tocar el rol de nadie", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: regularUser.id } });
    const result = await toggleSuperadminAction(otherAdmin.id);
    expect(result.ok).toBe(false);
  });

  it("promueve a un usuario regular a superadmin", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: superadmin.id } });
    const result = await toggleSuperadminAction(regularUser.id);
    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ platformRole: user.platformRole })
      .from(user)
      .where(eq(user.id, regularUser.id));
    expect(row?.platformRole).toBe("platform_admin");

    // revertir para no afectar el resto de esta suite
    getSessionMock.mockResolvedValueOnce({ user: { id: superadmin.id } });
    await toggleSuperadminAction(regularUser.id);
  });

  // La salvaguarda de "nunca dejar la plataforma sin superadmin" depende del conteo GLOBAL de
  // platform_admin en toda la tabla `user` — probarla de punta a punta acá sería flaky corriendo
  // junto a otros archivos de test que también crean/borran superadmins en paralelo contra la
  // misma base de datos de test. La lógica de la salvaguarda en sí (wouldRemoveLastSuperadmin) se
  // prueba aislada, sin DB, en tests/unit/superadmin-guard.test.ts.
});

describe("toggleOrganizationStatusAction + assertOrgActive", () => {
  it("bloquea una organización y assertOrgActive lo refleja de inmediato", async () => {
    const before = await assertOrgActive(org.id);
    expect(before.ok).toBe(true);

    getSessionMock.mockResolvedValueOnce({ user: { id: superadmin.id } });
    const toggled = await toggleOrganizationStatusAction(org.id);
    expect(toggled.ok).toBe(true);

    const after = await assertOrgActive(org.id);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("org_blocked");

    // desbloquear para dejar el fixture limpio
    getSessionMock.mockResolvedValueOnce({ user: { id: superadmin.id } });
    await toggleOrganizationStatusAction(org.id);
    const restored = await assertOrgActive(org.id);
    expect(restored.ok).toBe(true);
  });

  it("un no-superadmin no puede bloquear una organización", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: regularUser.id } });
    const result = await toggleOrganizationStatusAction(org.id);
    expect(result.ok).toBe(false);
  });
});
