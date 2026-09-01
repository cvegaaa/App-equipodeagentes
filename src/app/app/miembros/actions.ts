"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { membership, user as userTable } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { writeAuditLog } from "@/server/audit";
import { requireMembership } from "@/server/permissions";

const inviteMemberSchema = z.object({
  email: z.string().email("Correo inválido"),
  role: z.enum(["operator", "owner"]),
});

export type MemberActionResult = { ok: true } | { ok: false; error: string };

/**
 * Invita a un usuario que YA tiene cuenta en GEIFEM Agentes (ya inició sesión al menos una vez en
 * cualquier organización) a la organización activa. Simplificación deliberada: no crea una fila
 * `user` de antemano para alguien que nunca se ha registrado — evita el conflicto de email único
 * cuando esa persona intente crear su cuenta real más tarde. Si el correo no existe todavía, se
 * le pide a quien invita que la persona inicie sesión primero.
 */
export async function inviteMemberAction(
  _prevState: MemberActionResult | null,
  formData: FormData,
): Promise<MemberActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return { ok: false, error: "No tienes una organización activa." };

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const parsed = inviteMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const [invitedUser] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, parsed.data.email));
  if (!invitedUser) {
    return {
      ok: false,
      error:
        "Esa persona todavía no tiene cuenta — pídele que inicie sesión una vez y vuelve a intentar.",
    };
  }

  await db.insert(membership).values({
    userId: invitedUser.id,
    orgId: activeOrg.orgId,
    role: parsed.data.role,
    invitedBy: session.user.id,
    acceptedAt: new Date(),
  });

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "member.invited",
    targetType: "user",
    targetId: invitedUser.id,
    metadata: { role: parsed.data.role },
  });

  revalidatePath("/app/miembros");
  return { ok: true };
}

export async function removeMemberAction(membershipId: string): Promise<MemberActionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return { ok: false, error: "No tienes una organización activa." };

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const [target] = await db.select().from(membership).where(eq(membership.id, membershipId));
  if (!target || target.orgId !== activeOrg.orgId) {
    return { ok: false, error: "Membresía no encontrada." };
  }

  await db.delete(membership).where(eq(membership.id, membershipId));

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "member.removed",
    targetType: "membership",
    targetId: membershipId,
    metadata: { userId: target.userId },
  });

  revalidatePath("/app/miembros");
  return { ok: true };
}
