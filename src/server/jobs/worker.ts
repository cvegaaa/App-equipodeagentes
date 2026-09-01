import { randomUUID } from "node:crypto";
// Proceso standalone (no pasa por Next.js) — tiene que cargar .env él mismo, a diferencia de los
// route handlers/Server Components, que lo reciben gratis del runtime de Next.
import "dotenv/config";
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, runs } from "@/lib/db/schema";
import { sendTelegramMessage } from "@/lib/telegram";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { runAgentLoop } from "@/server/agent/loop";
// Registra las definiciones de agente (registerAgentDefinition por efecto de import) — sin esto el
// worker no sabría qué prompt/tools usar para ningún run.
import "@/server/agent/aux-contable/definition";
import "@/server/agent/platform-copilot/definition";

type JobRow = typeof jobs.$inferSelect;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reclama a lo sumo un job listo (`status='queued'`, `run_after <= now()`) con
 * `FOR UPDATE SKIP LOCKED` — nunca un `SELECT` simple seguido de `UPDATE`, que dejaría que dos
 * workers reclamen el mismo job bajo concurrencia (.claude/rules/agent-loop.md).
 */
export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), lte(jobs.runAfter, new Date())))
      .orderBy(asc(jobs.createdAt))
      .limit(1)
      .for("update", { of: jobs, skipLocked: true });

    if (!job) return null;

    await tx
      .update(jobs)
      .set({
        status: "claimed",
        claimedAt: new Date(),
        claimedBy: workerId,
        attempts: job.attempts + 1,
      })
      .where(eq(jobs.id, job.id));

    return job;
  });
}

/**
 * Si el run vino de un canal externo (p. ej. WhatsApp — `input.replyChannel`), entrega la
 * respuesta por ese mismo canal una vez el run llega a un estado terminal. Un fallo de entrega
 * no relanza — ya se hizo lo posible; queda en los logs del worker.
 */
async function deliverExternalReply(runId: string): Promise<void> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) return;

  const input = run.input as { replyChannel?: string; replyTo?: string } | null;
  if (!input?.replyChannel || !input.replyTo) return;
  if (input.replyChannel !== "whatsapp" && input.replyChannel !== "telegram") return;

  const result = run.result as { text?: string } | null;
  const text =
    run.status === "succeeded"
      ? (result?.text ?? "Listo.")
      : "No pude completar tu solicitud en este momento — inténtalo de nuevo más tarde.";

  const delivery =
    input.replyChannel === "whatsapp"
      ? await sendWhatsAppMessage(input.replyTo, text)
      : await sendTelegramMessage(input.replyTo, text);

  if (!delivery.ok) {
    console.error(
      `[worker] no se pudo entregar la respuesta de ${input.replyChannel} para run=${runId}:`,
      delivery.error.message,
    );
  }
}

/** Reclama y procesa a lo sumo un job. Devuelve `true` si había trabajo. */
export async function processNextJob(workerId: string): Promise<boolean> {
  const job = await claimNextJob(workerId);
  if (!job) return false;

  try {
    await runAgentLoop(job.runId);
    await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, job.id));
    await deliverExternalReply(job.runId);
  } catch (error) {
    // Un fallo del loop en sí (bug, no un error de tool) deja el job en 'failed' explícito — el
    // sweeper de runs atascados (E3-T3) es quien decide reintentar o no, no este proceso.
    await db.update(jobs).set({ status: "failed" }).where(eq(jobs.id, job.id));
    throw error;
  }
  return true;
}

export async function startWorker(options: { pollIntervalMs?: number } = {}): Promise<never> {
  const workerId = `worker-${process.pid}-${randomUUID()}`;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  for (;;) {
    const claimed = await processNextJob(workerId).catch((error) => {
      console.error("[worker] error procesando job:", error);
      return true; // no esperar el poll completo tras un fallo — reintentar pronto
    });
    if (!claimed) await sleep(pollIntervalMs);
  }
}

if (require.main === module) {
  startWorker().catch((error) => {
    console.error("[worker] fallo fatal:", error);
    process.exit(1);
  });
}
