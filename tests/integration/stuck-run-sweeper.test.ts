import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { organization, runs, steps } from "@/lib/db/schema";
import { sweepStuckRuns } from "@/server/jobs/stuck-run-sweeper";

const org = { id: randomUUID(), slug: `stuck-run-sweeper-test-${randomUUID()}` };

const STALE = new Date(Date.now() - 10 * 60 * 1000); // 10 min — pasa el umbral de 5 min
const FRESH = new Date(Date.now() - 30 * 1000); // 30s — dentro del umbral

async function insertRun(status: string, heartbeatAt: Date | null) {
  const [run] = await db
    .insert(runs)
    .values({ orgId: org.id, triggerType: "chat_request", status, heartbeatAt })
    .returning();
  return run;
}

beforeAll(async () => {
  await db.insert(organization).values({ id: org.id, name: "Org de prueba", slug: org.slug });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org.id));
});

describe("sweepStuckRuns", () => {
  it("marca 'failed' un run 'running' con heartbeat vencido", async () => {
    const stuckRun = await insertRun("running", STALE);

    const result = await sweepStuckRuns();
    expect(result.sweptRunIds).toContain(stuckRun.id);

    const [updated] = await db.select().from(runs).where(eq(runs.id, stuckRun.id));
    expect(updated.status).toBe("failed");
    expect(updated.endedAt).not.toBeNull();

    const errorSteps = await db.select().from(steps).where(eq(steps.runId, stuckRun.id));
    expect(errorSteps).toHaveLength(1);
    expect(errorSteps[0].state).toBe("error");
  });

  it("no toca un run 'running' con heartbeat reciente", async () => {
    const healthyRun = await insertRun("running", FRESH);

    const result = await sweepStuckRuns();
    expect(result.sweptRunIds).not.toContain(healthyRun.id);

    const [unchanged] = await db.select().from(runs).where(eq(runs.id, healthyRun.id));
    expect(unchanged.status).toBe("running");
  });

  it("no toca un run ya terminado aunque su heartbeat esté vencido", async () => {
    const finishedRun = await insertRun("succeeded", STALE);

    const result = await sweepStuckRuns();
    expect(result.sweptRunIds).not.toContain(finishedRun.id);

    const [unchanged] = await db.select().from(runs).where(eq(runs.id, finishedRun.id));
    expect(unchanged.status).toBe("succeeded");
  });
});
