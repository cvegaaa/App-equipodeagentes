import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runs, steps, traces } from "@/lib/db/schema";
import { requireMembership } from "@/server/permissions";

// GET /api/v1/runs/:id — consulta bajo demanda de un run individual (blueprint.md §5). Recurso de
// otra organización responde 404, nunca 403 (no confirma existencia).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized" } }, { status: 401 });
  }

  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) {
    return NextResponse.json({ ok: false, error: { code: "not_found" } }, { status: 404 });
  }

  const membershipCheck = await requireMembership(session.user.id, run.orgId);
  if (!membershipCheck.ok) {
    return NextResponse.json({ ok: false, error: { code: "not_found" } }, { status: 404 });
  }

  const [runSteps, runTraces] = await Promise.all([
    db.select().from(steps).where(eq(steps.runId, id)),
    db.select().from(traces).where(eq(traces.runId, id)),
  ]);

  return NextResponse.json({ ok: true, data: { run, steps: runSteps, traces: runTraces } });
}
