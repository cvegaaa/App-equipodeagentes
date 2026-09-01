import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActiveOrg } from "@/server/active-org";
import { enqueueJob } from "@/server/jobs/enqueue";
import { assertOrgActive } from "@/server/org-status";
import { requireMembership } from "@/server/permissions";
import { copilotRequestSchema } from "./route.schema";

// POST /api/v1/copilot — el copiloto de plataforma, no un agente de catálogo
// (docs/plataforma-multiagente-pivot.md §5): sin agent_config, sin toggle de activación. Solo
// admin (owner) por ahora — puede crear conectores con credenciales
// (docs/roles-y-workspaces-2026-08.md). Responde 202 igual que /api/v1/chat — el trabajo ocurre en
// el worker.
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized" } }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = copilotRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "validation_error", message: parsed.error.issues[0]?.message } },
      { status: 422 },
    );
  }

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) {
    return NextResponse.json({ ok: false, error: { code: "not_found" } }, { status: 404 });
  }

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId, "owner");
  if (!membershipCheck.ok) {
    const status = membershipCheck.error.code === "not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: membershipCheck.error }, { status });
  }

  const orgGuard = await assertOrgActive(activeOrg.orgId);
  if (!orgGuard.ok) {
    return NextResponse.json({ ok: false, error: orgGuard.error }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  const { runId } = await enqueueJob("copilot_request", {
    orgId: activeOrg.orgId,
    agentType: "platform_copilot",
    // userId viaja en `input` (no hay columna dedicada en `runs` — ver src/lib/connectors/registry.ts
    // ToolContext) para que save_custom_agent pueda registrar quién creó el agente.
    input: { message: parsed.data.message, userId: session.user.id },
    idempotencyKey,
  });

  return NextResponse.json({ ok: true, data: { runId, status: "queued" } }, { status: 202 });
}
