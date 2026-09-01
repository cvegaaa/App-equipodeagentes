import { and, eq, isNotNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { membership, organization } from "@/lib/db/schema";

// Puente hasta que exista un flujo de invitación real con un selector persistido en sesión
// (blueprint §8 lo describe así, pero ninguna tarea construida hasta ahora lo implementa) — la
// organización activa vive en una cookie, con la primera membresía aceptada como default.
export const ACTIVE_ORG_COOKIE = "active_org_id";

export type MembershipWithOrg = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgStatus: "active" | "blocked";
  role: "owner" | "operator";
};

export async function listAcceptedMemberships(userId: string): Promise<MembershipWithOrg[]> {
  const rows = await db
    .select({
      orgId: membership.orgId,
      role: membership.role,
      orgName: organization.name,
      orgSlug: organization.slug,
      orgStatus: organization.status,
    })
    .from(membership)
    .innerJoin(organization, eq(organization.id, membership.orgId))
    .where(and(eq(membership.userId, userId), isNotNull(membership.acceptedAt)));
  return rows as MembershipWithOrg[];
}

/** Resuelve la organización activa: la de la cookie si el usuario sigue siendo miembro, si no la primera. */
export async function resolveActiveOrg(userId: string): Promise<MembershipWithOrg | null> {
  const memberships = await listAcceptedMemberships(userId);
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const fromCookie = cookieOrgId ? memberships.find((m) => m.orgId === cookieOrgId) : undefined;
  return fromCookie ?? memberships[0];
}
