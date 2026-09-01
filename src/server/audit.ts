import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

type WriteAuditLogParams = {
  /** `null` para acciones del sistema sin un actor humano (p. ej. el worker). */
  actorId: string | null;
  orgId: string | null;
  /** String estable `objeto.verbo`, ej. `organization.created`, `app_connection.saved`. */
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
};

/**
 * Único escritor de `audit_log` (append-only — CLAUDE.md regla 7, .claude/rules/db-schema.md).
 * Ningún otro módulo hace INSERT/UPDATE/DELETE sobre esa tabla.
 */
export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  await db.insert(auditLog).values({
    actorId: params.actorId,
    orgId: params.orgId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadata: params.metadata ?? {},
  });
}
