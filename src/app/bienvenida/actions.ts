"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { membership, organization } from "@/lib/db/schema";
import { slugify } from "@/lib/slug";
import { writeAuditLog } from "@/server/audit";

const createWorkspaceSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(120),
});

export type CreateWorkspaceResult = { ok: true } | { ok: false; error: string };

/**
 * Crea el espacio de trabajo individual de quien hace login por primera vez sin invitación — una
 * organización normal, de un solo miembro, sin flujo de invitación (docs/roles-y-workspaces-2026-08.md
 * — un "workspace" no es un concepto separado, reusa `organization`). Quien lo crea queda como
 * `owner` — es su propio espacio, nadie más lo administra.
 */
export async function createPersonalWorkspaceAction(
  _prevState: CreateWorkspaceResult | null,
  formData: FormData,
): Promise<CreateWorkspaceResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const parsed = createWorkspaceSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const baseSlug = slugify(parsed.data.name);
  if (!baseSlug) return { ok: false, error: "El nombre no produce un slug válido." };

  let slug = baseSlug;
  let attempt = 1;
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

  await db.insert(membership).values({
    userId: session.user.id,
    orgId: created.id,
    role: "owner",
    acceptedAt: new Date(),
  });

  await writeAuditLog({
    actorId: session.user.id,
    orgId: created.id,
    action: "organization.created",
    targetType: "organization",
    targetId: created.id,
    metadata: { name: created.name, slug: created.slug, source: "onboarding_individual" },
  });

  redirect("/app");
}
