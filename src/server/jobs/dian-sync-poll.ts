import { and, eq } from "drizzle-orm";
import { listBillsTool } from "@/lib/connectors/providers/alegra/tools";
import type { RestConnection } from "@/lib/connectors/rest-client";
import { db } from "@/lib/db";
import { agentConfig, appConnections, dianSyncCursor } from "@/lib/db/schema";
import { decryptToken } from "@/lib/encryption";
import { assertAgentEnabled } from "@/server/agent/aux-contable/definition";
import { enqueueJob } from "@/server/jobs/enqueue";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Traduce `agent_config.sync_schedule` (expresión cron) a un intervalo en ms. Solo reconoce las
 * formas usadas en este proyecto (diario, cada N horas) — no es un parser de cron genérico;
 * cualquier expresión no reconocida cae al default conservador de 24h.
 */
export function cronIntervalMs(expr: string): number {
  if (expr === "0 0 * * *") return 24 * HOUR_MS;
  const everyNHours = expr.match(/^0 \*\/(\d+) \* \* \*$/);
  if (everyNHours) return Number(everyNHours[1]) * HOUR_MS;
  return 24 * HOUR_MS;
}

async function isDueForSync(orgId: string, syncSchedule: string): Promise<boolean> {
  const [cursor] = await db.select().from(dianSyncCursor).where(eq(dianSyncCursor.orgId, orgId));
  if (!cursor?.lastSyncedAt) return true;
  return Date.now() - cursor.lastSyncedAt.getTime() >= cronIntervalMs(syncSchedule);
}

/**
 * Sincroniza una sola organización: consulta el documento más reciente que Alegra ya sincronizó
 * desde la DIAN en su propio entorno (este proyecto no habla con la DIAN, ver
 * docs/connector-integration-decision.md) y encola un run `dian_sync` solo si es distinto al
 * último visto. Devuelve cuántos jobs encoló (0 o 1).
 */
export async function pollOrgDianSync(orgId: string): Promise<number> {
  const [config] = await db.select().from(agentConfig).where(eq(agentConfig.orgId, orgId));
  if (!assertAgentEnabled(config).ok) return 0;

  const [connectionRow] = await db
    .select()
    .from(appConnections)
    .where(and(eq(appConnections.orgId, orgId), eq(appConnections.providerKey, "alegra")));
  if (!connectionRow) return 0; // sin conexión Alegra configurada, nada que sincronizar

  const connection: RestConnection = {
    baseUrl: connectionRow.baseUrl,
    authType: connectionRow.authType as RestConnection["authType"],
    authHeaderName: connectionRow.authHeaderName,
    token: decryptToken(connectionRow.encryptedToken),
  };

  const listResult = await listBillsTool.handler({ start: 0, limit: 1 }, { connection });
  if (!listResult.ok || !Array.isArray(listResult.data) || listResult.data.length === 0) return 0;

  const mostRecent = listResult.data[0] as { id: number | string };
  const mostRecentId = String(mostRecent.id);

  const [cursor] = await db.select().from(dianSyncCursor).where(eq(dianSyncCursor.orgId, orgId));
  if (cursor?.lastExternalDocumentId === mostRecentId) {
    return 0; // ya visto — cero jobs adicionales
  }

  await enqueueJob("dian_sync", { orgId, input: { documentId: mostRecentId } });

  if (cursor) {
    await db
      .update(dianSyncCursor)
      .set({ lastSyncedAt: new Date(), lastExternalDocumentId: mostRecentId })
      .where(eq(dianSyncCursor.orgId, orgId));
  } else {
    await db
      .insert(dianSyncCursor)
      .values({ orgId, lastSyncedAt: new Date(), lastExternalDocumentId: mostRecentId });
  }
  return 1;
}

/** Recorre todas las organizaciones con el agente habilitado, respetando su `sync_schedule`. */
export async function pollDianSync(): Promise<{ orgsProcessed: number; jobsEnqueued: number }> {
  const configs = await db
    .select({ orgId: agentConfig.orgId, syncSchedule: agentConfig.syncSchedule })
    .from(agentConfig)
    .where(eq(agentConfig.enabled, true));

  let jobsEnqueued = 0;
  let orgsProcessed = 0;
  for (const config of configs) {
    if (!(await isDueForSync(config.orgId, config.syncSchedule))) continue;
    orgsProcessed += 1;
    jobsEnqueued += await pollOrgDianSync(config.orgId);
  }
  return { orgsProcessed, jobsEnqueued };
}
