"use server";

import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { writeAuditLog } from "@/server/audit";
import { requirePlatformAdmin } from "@/server/permissions";
import { wouldRemoveLastSuperadmin } from "./superadmin-guard";

export type ToggleSuperadminResult = { ok: true } | { ok: false; error: string };

/**
 * Promueve o degrada a un usuario a `platform_admin` (superadmin) — nunca deja la plataforma sin
 * ningún superadmin: rechaza degradar al último que queda (docs/roles-y-workspaces-2026-08.md).
 */
export async function toggleSuperadminAction(
  targetUserId: string,
): Promise<ToggleSuperadminResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const guard = await requirePlatformAdmin(session.user.id);
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const [target] = await db
    .select({ platformRole: user.platformRole })
    .from(user)
    .where(eq(user.id, targetUserId));
  if (!target) return { ok: false, error: "Usuario no encontrado." };

  const isCurrentlyAdmin = target.platformRole === "platform_admin";

  if (isCurrentlyAdmin) {
    const [{ value: adminCount }] = await db
      .select({ value: count() })
      .from(user)
      .where(eq(user.platformRole, "platform_admin"));
    if (wouldRemoveLastSuperadmin(adminCount)) {
      return { ok: false, error: "No puedes quitar al último superadmin de la plataforma." };
    }
  }

  await db
    .update(user)
    .set({ platformRole: isCurrentlyAdmin ? null : "platform_admin" })
    .where(eq(user.id, targetUserId));

  await writeAuditLog({
    actorId: session.user.id,
    orgId: null,
    action: isCurrentlyAdmin ? "user.superadmin_revoked" : "user.superadmin_granted",
    targetType: "user",
    targetId: targetUserId,
  });

  revalidatePath("/app/plataforma/usuarios");
  return { ok: true };
}
