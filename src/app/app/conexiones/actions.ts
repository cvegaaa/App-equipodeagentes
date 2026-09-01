"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appConnections } from "@/lib/db/schema";
import { encryptToken } from "@/lib/encryption";
import { resolveActiveOrg } from "@/server/active-org";
import { writeAuditLog } from "@/server/audit";
import { requireMembership } from "@/server/permissions";

const saveConnectionSchema = z
  .object({
    providerKey: z.string().min(1),
    baseUrl: z.string().url("La URL base debe ser una URL válida"),
    authType: z.enum(["bearer_token", "api_key_header", "basic"]),
    authHeaderName: z.string().optional(),
    token: z.string().min(1, "El token no puede estar vacío"),
  })
  .refine((data) => data.authType !== "api_key_header" || !!data.authHeaderName, {
    message: "auth_header_name es requerido para auth_type='api_key_header'",
    path: ["authHeaderName"],
  });

export type SaveConnectionResult = { ok: true } | { ok: false; error: string };

export async function saveConnectionAction(
  _prevState: SaveConnectionResult | null,
  formData: FormData,
): Promise<SaveConnectionResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "No autenticado." };

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) return { ok: false, error: "No tienes una organización activa." };

  const guard = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!guard.ok) return { ok: false, error: "No autorizado." };

  const parsed = saveConnectionSchema.safeParse({
    providerKey: formData.get("providerKey"),
    baseUrl: formData.get("baseUrl"),
    authType: formData.get("authType"),
    authHeaderName: formData.get("authHeaderName") || undefined,
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  // Cifrado ANTES de tocar la base — nunca se escribe el token en texto plano
  // (.claude/rules/db-schema.md, CLAUDE.md regla no negociable #1).
  const encryptedToken = encryptToken(parsed.data.token);

  await db
    .insert(appConnections)
    .values({
      orgId: activeOrg.orgId,
      providerKey: parsed.data.providerKey,
      baseUrl: parsed.data.baseUrl,
      authType: parsed.data.authType,
      authHeaderName: parsed.data.authType === "api_key_header" ? parsed.data.authHeaderName : null,
      encryptedToken,
      enteredByUserId: session.user.id,
    })
    .onConflictDoUpdate({
      target: [appConnections.orgId, appConnections.providerKey],
      set: {
        baseUrl: parsed.data.baseUrl,
        authType: parsed.data.authType,
        authHeaderName:
          parsed.data.authType === "api_key_header" ? parsed.data.authHeaderName : null,
        encryptedToken,
        enteredByUserId: session.user.id,
        updatedAt: new Date(),
      },
    });

  await writeAuditLog({
    actorId: session.user.id,
    orgId: activeOrg.orgId,
    action: "app_connection.saved",
    targetType: "app_connections",
    targetId: parsed.data.providerKey,
    metadata: { providerKey: parsed.data.providerKey, authType: parsed.data.authType },
  });

  revalidatePath("/app/conexiones");
  return { ok: true };
}
