import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs, steps } from "@/lib/db/schema";

// El loop del agente actualiza heartbeat_at en cada iteración (src/server/agent/loop.ts) — un run
// 'running' cuyo heartbeat lleva más que esto sin refrescarse significa que el worker que lo tenía
// murió o se colgó. 5 minutos es generoso frente al intervalo real entre heartbeats (una llamada al
// modelo por step, normalmente segundos).
const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * Marca `status='failed'` cada run `'running'` con `heartbeat_at` vencido — ver
 * `blueprint.md` §11 (métrica "runs colgados") y `.claude/rules/agent-loop.md`. Nunca reintenta:
 * el run puede haber dejado un tool_call a mitad de ejecución, y reintentar podría duplicar el
 * efecto en Alegra.
 */
export async function sweepStuckRuns(): Promise<{ sweptRunIds: string[] }> {
  const staleBefore = new Date(Date.now() - STALE_HEARTBEAT_MS);

  const stuckRuns = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.status, "running"), lt(runs.heartbeatAt, staleBefore)));

  for (const run of stuckRuns) {
    const [lastStep] = await db
      .select({ ordinal: steps.ordinal })
      .from(steps)
      .where(eq(steps.runId, run.id))
      .orderBy(desc(steps.ordinal))
      .limit(1);

    await db.insert(steps).values({
      runId: run.id,
      ordinal: (lastStep?.ordinal ?? -1) + 1,
      kind: "model",
      state: "error",
      error:
        "Run marcado como atascado por el sweeper — heartbeat vencido sin actividad del worker.",
    });

    await db.update(runs).set({ status: "failed", endedAt: new Date() }).where(eq(runs.id, run.id));
  }

  return { sweptRunIds: stuckRuns.map((r) => r.id) };
}
