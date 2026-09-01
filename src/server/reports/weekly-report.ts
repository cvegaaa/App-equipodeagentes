import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfig, runs, weeklyReport } from "@/lib/db/schema";

const PROBLEMATIC_STATUSES = new Set(["failed", "budget_exceeded", "cancelled"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type RunRow = typeof runs.$inferSelect;

function buildClientContent(successfulRuns: RunRow[]): string {
  if (successfulRuns.length === 0) {
    return "Esta semana el Auxiliar Contable no tuvo actividad para reportar.";
  }
  const lines = successfulRuns.map((run) => {
    const result = run.result as { text?: string } | null;
    return `- ${result?.text ?? "Se completó una gestión contable."}`;
  });
  return [
    `Resumen de esta semana (${successfulRuns.length} gestiones completadas):`,
    ...lines,
  ].join("\n");
}

function buildOperatorContent(successfulRuns: RunRow[], problematicRuns: RunRow[]): string {
  const lines = [
    `Runs exitosos: ${successfulRuns.length}`,
    `Runs con incidencia: ${problematicRuns.length}`,
  ];
  if (problematicRuns.length > 0) {
    lines.push("Incidencias:");
    for (const run of problematicRuns) {
      lines.push(`- run ${run.id} (trigger=${run.triggerType}): status=${run.status}`);
    }
  }
  return lines.join("\n");
}

/**
 * Genera el reporte semanal de una organización para el periodo [periodStart, periodStart + 7d).
 * Inserta las dos filas (`audience='client'` y `audience='operator'`) en una sola transacción —
 * si el periodo ya se generó, la restricción unique de `weekly_report` hace fallar el intento
 * completo, sin dejar una sola fila duplicada a medias.
 */
export async function generateWeeklyReport(
  orgId: string,
  periodStart: Date,
): Promise<{ clientReportId: string; operatorReportId: string }> {
  const periodEnd = new Date(periodStart.getTime() + WEEK_MS);

  const periodRuns = await db
    .select()
    .from(runs)
    .where(
      and(eq(runs.orgId, orgId), gte(runs.createdAt, periodStart), lt(runs.createdAt, periodEnd)),
    );

  const successfulRuns = periodRuns.filter((run) => run.status === "succeeded");
  const problematicRuns = periodRuns.filter((run) => PROBLEMATIC_STATUSES.has(run.status));

  const periodStartStr = toDateString(periodStart);
  const periodEndStr = toDateString(periodEnd);

  return db.transaction(async (tx) => {
    const [clientReport] = await tx
      .insert(weeklyReport)
      .values({
        orgId,
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
        audience: "client",
        content: buildClientContent(successfulRuns),
        generatedFrom: { runIds: successfulRuns.map((run) => run.id) },
      })
      .returning({ id: weeklyReport.id });

    const [operatorReport] = await tx
      .insert(weeklyReport)
      .values({
        orgId,
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
        audience: "operator",
        content: buildOperatorContent(successfulRuns, problematicRuns),
        generatedFrom: { runIds: periodRuns.map((run) => run.id) },
      })
      .returning({ id: weeklyReport.id });

    return { clientReportId: clientReport.id, operatorReportId: operatorReport.id };
  });
}

/** Genera el reporte semanal para todas las organizaciones con el agente habilitado. */
export async function generateWeeklyReportsForAllOrgs(
  periodStart: Date,
): Promise<{ orgsProcessed: number; orgsSkipped: number }> {
  const enabledOrgs = await db
    .select({ orgId: agentConfig.orgId })
    .from(agentConfig)
    .where(eq(agentConfig.enabled, true));

  let orgsProcessed = 0;
  let orgsSkipped = 0;
  for (const org of enabledOrgs) {
    try {
      await generateWeeklyReport(org.orgId, periodStart);
      orgsProcessed += 1;
    } catch {
      // Ya generado para este periodo (unique constraint) u otro fallo puntual — no bloquea al
      // resto de organizaciones.
      orgsSkipped += 1;
    }
  }
  return { orgsProcessed, orgsSkipped };
}
