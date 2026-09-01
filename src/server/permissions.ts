import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { membership, user } from "@/lib/db/schema";

type PermissionError = { code: "not_found" } | { code: "forbidden" };
type PermissionResult<T> = { ok: true; data: T } | { ok: false; error: PermissionError };

export type MembershipRole = "owner" | "operator";
type MembershipRow = { role: MembershipRole };

// 'owner' ("Administrador") >= 'operator' ("Usuario") — un owner satisface cualquier chequeo que
// pida operator, igual que en cualquier jerarquía de roles (docs/roles-y-workspaces-2026-08.md).
const ROLE_RANK: Record<MembershipRole, number> = { operator: 1, owner: 2 };

/**
 * Verifica que `userId` tiene una membresía aceptada en `orgId`. `404` (nunca `403`) si no
 * pertenece a la organización — no confirma su existencia a quien no es miembro (blueprint §8).
 * `minRole` por defecto es `"operator"` — cualquier miembro aceptado (el nivel más bajo que existe
 * hoy); `minRole: "owner"` exige administrador exacto o superior.
 */
export async function requireMembership(
  userId: string,
  orgId: string,
  minRole: MembershipRole = "operator",
): Promise<PermissionResult<MembershipRow>> {
  const [row] = await db
    .select({ role: membership.role, acceptedAt: membership.acceptedAt })
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.orgId, orgId)));

  if (!row?.acceptedAt) {
    return { ok: false, error: { code: "not_found" } };
  }
  const role = row.role as MembershipRole;
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return { ok: false, error: { code: "forbidden" } };
  }
  return { ok: true, data: { role } };
}

/**
 * Verifica que `userId` tiene `platform_role = 'platform_admin'` (superadmin) — acceso
 * plataforma-wide, no acotado a una organización (crear/bloquear organizaciones, promover
 * superadmins, panel de observabilidad cross-tenant).
 */
export async function requirePlatformAdmin(
  userId: string,
): Promise<PermissionResult<{ platformRole: "platform_admin" }>> {
  const [row] = await db
    .select({ platformRole: user.platformRole })
    .from(user)
    .where(eq(user.id, userId));

  if (row?.platformRole !== "platform_admin") {
    return { ok: false, error: { code: "forbidden" } };
  }
  return { ok: true, data: { platformRole: "platform_admin" } };
}
