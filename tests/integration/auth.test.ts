import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { membership, organization, user } from "@/lib/db/schema";
import { proxy } from "@/proxy";
import { requireMembership, requirePlatformAdmin } from "@/server/permissions";

const fixtures = {
  orgNoMembership: { id: randomUUID(), slug: `auth-test-no-membership-${randomUUID()}` },
  orgOperator: { id: randomUUID(), slug: `auth-test-operator-${randomUUID()}` },
  outsider: { id: randomUUID(), email: `outsider-${randomUUID()}@test.geifem.local` },
  operatorUser: { id: randomUUID(), email: `operator-${randomUUID()}@test.geifem.local` },
  ownerUser: { id: randomUUID(), email: `owner-${randomUUID()}@test.geifem.local` },
  adminUser: { id: randomUUID(), email: `admin-${randomUUID()}@test.geifem.local` },
};

beforeAll(async () => {
  await db.insert(organization).values([
    {
      id: fixtures.orgNoMembership.id,
      name: "Org sin membresía",
      slug: fixtures.orgNoMembership.slug,
    },
    { id: fixtures.orgOperator.id, name: "Org con usuario", slug: fixtures.orgOperator.slug },
  ]);
  await db.insert(user).values([
    { id: fixtures.outsider.id, email: fixtures.outsider.email, name: "Outsider" },
    { id: fixtures.operatorUser.id, email: fixtures.operatorUser.email, name: "Usuario" },
    { id: fixtures.ownerUser.id, email: fixtures.ownerUser.email, name: "Owner" },
    {
      id: fixtures.adminUser.id,
      email: fixtures.adminUser.email,
      name: "Admin",
      platformRole: "platform_admin",
    },
  ]);
  await db.insert(membership).values([
    {
      userId: fixtures.operatorUser.id,
      orgId: fixtures.orgOperator.id,
      role: "operator",
      acceptedAt: new Date(),
    },
    {
      userId: fixtures.ownerUser.id,
      orgId: fixtures.orgOperator.id,
      role: "owner",
      acceptedAt: new Date(),
    },
  ]);
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, fixtures.orgNoMembership.id));
  await db.delete(organization).where(eq(organization.id, fixtures.orgOperator.id));
  await db.delete(user).where(eq(user.id, fixtures.outsider.id));
  await db.delete(user).where(eq(user.id, fixtures.operatorUser.id));
  await db.delete(user).where(eq(user.id, fixtures.ownerUser.id));
  await db.delete(user).where(eq(user.id, fixtures.adminUser.id));
});

describe("proxy — primera capa de protección de /app", () => {
  it("redirige a /login cuando no hay cookie de sesión", () => {
    const request = new NextRequest("http://localhost:3000/app/reportes");
    const response = proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("no interfiere con rutas públicas", () => {
    const request = new NextRequest("http://localhost:3000/login");
    const response = proxy(request);
    expect(response.status).not.toBe(307);
  });

  it("nunca bloquea /api/auth/** sin cookie — es como se obtiene la cookie en primer lugar", () => {
    const request = new NextRequest("http://localhost:3000/api/auth/sign-in/email");
    const response = proxy(request);
    expect(response.status).not.toBe(307);
  });

  it("nunca bloquea /api/cron/** sin cookie — se autentica con Bearer $CRON_SECRET en el handler", () => {
    const request = new NextRequest("http://localhost:3000/api/cron/stuck-run-sweeper");
    const response = proxy(request);
    expect(response.status).not.toBe(307);
  });
});

describe("requireMembership", () => {
  it("responde not_found si el usuario no tiene membresía en la organización", async () => {
    const result = await requireMembership(fixtures.outsider.id, fixtures.orgNoMembership.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("responde forbidden si role='operator' pero se exige minRole='owner'", async () => {
    const result = await requireMembership(
      fixtures.operatorUser.id,
      fixtures.orgOperator.id,
      "owner",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });

  it("responde ok para un operator cuando minRole='operator' (default)", async () => {
    const result = await requireMembership(fixtures.operatorUser.id, fixtures.orgOperator.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.role).toBe("operator");
  });

  it("un owner satisface minRole='operator' — la jerarquía es inclusiva, no exacta", async () => {
    const result = await requireMembership(
      fixtures.ownerUser.id,
      fixtures.orgOperator.id,
      "operator",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.role).toBe("owner");
  });

  it("un owner también pasa minRole='owner'", async () => {
    const result = await requireMembership(fixtures.ownerUser.id, fixtures.orgOperator.id, "owner");
    expect(result.ok).toBe(true);
  });
});

describe("requirePlatformAdmin", () => {
  it("responde ok para platform_role='platform_admin'", async () => {
    const result = await requirePlatformAdmin(fixtures.adminUser.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.platformRole).toBe("platform_admin");
  });

  it("responde forbidden para un usuario sin platform_role", async () => {
    const result = await requirePlatformAdmin(fixtures.operatorUser.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });
});
