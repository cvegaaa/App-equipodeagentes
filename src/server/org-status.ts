import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";

/**
 * Una organización bloqueada por el superadmin no puede encolar trabajo nuevo (chat, copiloto) —
 * ninguna fila se toca al bloquear, solo se corta la puerta de entrada
 * (docs/roles-y-workspaces-2026-08.md). Compartido entre las rutas que de verdad importan
 * (`/api/v1/chat`, `/api/v1/copilot`) — no se repite en cada página de solo lectura.
 */
export async function assertOrgActive(
  orgId: string,
): Promise<{ ok: true } | { ok: false; error: { code: "org_blocked"; message: string } }> {
  const [row] = await db
    .select({ status: organization.status })
    .from(organization)
    .where(eq(organization.id, orgId));
  if (row?.status === "blocked") {
    return {
      ok: false,
      error: {
        code: "org_blocked",
        message: "Esta organización está bloqueada por la plataforma.",
      },
    };
  }
  return { ok: true };
}
