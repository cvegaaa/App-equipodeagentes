"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { slugify } from "@/lib/slug";
import { writeAuditLog } from "@/server/audit";
import { requirePlatformAdmin } from "@/server/permissions";

const createOrganizationSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(120),
});

export type CreateOrganizationResult = { ok: true } | { ok: false; error: string };

export async function createOrganizationAction(
  _prevState: CreateOrganizationResult | null,
  formData: FormData,
): Promise<CreateOrganizationResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const guard = await requirePlatformAdmin(session.user.id);
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const parsed = createOrganizationSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const baseSlug = slugify(parsed.data.name);
  if (!baseSlug) return { ok: false, error: "El nombre no produce un slug válido." };

  let slug = baseSlug;
  let attempt = 1;
  // El slug es inmutable y único — si ya existe, se sufija hasta encontrar uno libre.
  while (true) {
    const [existing] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug));
    if (!existing) break;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const [created] = await db
    .insert(organization)
    .values({ name: parsed.data.name, slug })
    .returning();

  await writeAuditLog({
    actorId: session.user.id,
    orgId: created.id,
    action: "organization.created",
    targetType: "organization",
    targetId: created.id,
    metadata: { name: created.name, slug: created.slug },
  });

  revalidatePath("/app/organizaciones");
  return { ok: true };
}

/**
 * Bloquea o desbloquea una organización — una org bloqueada no puede enviar mensajes de
 * chat/copiloto ni activar agentes (aplicado en las rutas correspondientes), pero ninguna fila se
 * borra ni se pierde (docs/roles-y-workspaces-2026-08.md).
 */
export async function toggleOrganizationStatusAction(
  orgId: string,
): Promise<CreateOrganizationResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const guard = await requirePlatformAdmin(session.user.id);
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const [org] = await db
    .select({ status: organization.status })
    .from(organization)
    .where(eq(organization.id, orgId));
  if (!org) return { ok: false, error: "Organización no encontrada." };

  const nextStatus = org.status === "active" ? "blocked" : "active";
  await db.update(organization).set({ status: nextStatus }).where(eq(organization.id, orgId));

  await writeAuditLog({
    actorId: session.user.id,
    orgId,
    action: nextStatus === "blocked" ? "organization.blocked" : "organization.unblocked",
    targetType: "organization",
    targetId: orgId,
  });

  revalidatePath("/app/organizaciones");
  return { ok: true };
}
