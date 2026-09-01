import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, runs } from "@/lib/db/schema";

export type TriggerType = "dian_sync" | "chat_request" | "invoice_request" | "copilot_request";

type EnqueuePayload = {
  orgId: string;
  agentType?: string;
  input?: Record<string, unknown>;
  /** Header `Idempotency-Key` del cliente — repetirla devuelve el mismo run, sin encolar otro job. */
  idempotencyKey?: string;
};

/**
 * Inserta la fila `runs` (status='queued') y su fila `jobs` en una sola transacción — el llamador
 * (p. ej. `POST /api/v1/chat`) responde en cuanto esto commitea, sin esperar al worker. Si se pasa
 * `idempotencyKey` y ya existe un run con esa clave en la misma organización, la devuelve sin
 * encolar nada nuevo.
 */
export async function enqueueJob(
  type: TriggerType,
  payload: EnqueuePayload,
): Promise<{ runId: string; jobId: string | null }> {
  return db.transaction(async (tx) => {
    if (payload.idempotencyKey) {
      const [existing] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.orgId, payload.orgId), eq(runs.idempotencyKey, payload.idempotencyKey)));
      if (existing) return { runId: existing.id, jobId: null };
    }

    const [run] = await tx
      .insert(runs)
      .values({
        orgId: payload.orgId,
        agentType: payload.agentType ?? "aux_contable",
        triggerType: type,
        status: "queued",
        input: payload.input ?? {},
        idempotencyKey: payload.idempotencyKey,
      })
      .returning({ id: runs.id });

    const [job] = await tx.insert(jobs).values({ runId: run.id }).returning({ id: jobs.id });

    return { runId: run.id, jobId: job.id };
  });
}
