import { and, eq, isNotNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfig, customAgents, membership } from "@/lib/db/schema";
import { assertAgentEnabled } from "@/server/agent/aux-contable/definition";
import { enqueueJob } from "@/server/jobs/enqueue";
import { assertOrgActive } from "@/server/org-status";
import { requireMembership } from "@/server/permissions";
import { chatRequestSchema } from "./route.schema";

const CUSTOM_AGENT_PREFIX = "custom:";

type GateError = { code: string; message: string };

/**
 * Un agente de catálogo se habilita con `agent_config.enabled` (Aux Contable, sin cambios); un
 * agente custom se habilita con `custom_agents.status === 'active'` — no tiene fila `agent_config`
 * propia en v1 (docs/plataforma-multiagente-pivot.md §3). `orgId` explícito en el `WHERE` en
 * ambos casos — nunca se resuelve un agente por id solo.
 */
async function assertAgentRunnable(
  orgId: string,
  agentType: string,
): Promise<{ ok: true } | { ok: false; error: GateError }> {
  if (agentType.startsWith(CUSTOM_AGENT_PREFIX)) {
    const customAgentId = agentType.slice(CUSTOM_AGENT_PREFIX.length);
    const [row] = await db
      .select({ status: customAgents.status })
      .from(customAgents)
      .where(and(eq(customAgents.id, customAgentId), eq(customAgents.orgId, orgId)));
    if (row?.status !== "active") {
      return {
        ok: false,
        error: {
          code: "agent_disabled",
          message: "Este agente no está activo para esta organización.",
        },
      };
    }
    return { ok: true };
  }

  const [config] = await db
    .select()
    .from(agentConfig)
    .where(and(eq(agentConfig.orgId, orgId), eq(agentConfig.agentType, agentType)));
  return assertAgentEnabled(config);
}

async function resolveOrgId(userId: string, requestedOrgId?: string): Promise<string | null> {
  if (requestedOrgId) return requestedOrgId;
  const accepted = await db
    .select({ orgId: membership.orgId })
    .from(membership)
    .where(and(eq(membership.userId, userId), isNotNull(membership.acceptedAt)));
  return accepted.length === 1 ? accepted[0].orgId : null;
}

// POST /api/v1/chat responde en cuanto runs+jobs commitean — el trabajo del agente ocurre en el
// worker, nunca dentro de este handler (.claude/rules/api-routes.md).
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized" } }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "validation_error", message: parsed.error.issues[0]?.message } },
      { status: 422 },
    );
  }

  const orgId = await resolveOrgId(session.user.id, parsed.data.orgId);
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "validation_error",
          message: "No se pudo determinar la organización — envía orgId explícito.",
        },
      },
      { status: 422 },
    );
  }

  const membershipCheck = await requireMembership(session.user.id, orgId, "operator");
  if (!membershipCheck.ok) {
    const status = membershipCheck.error.code === "not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: membershipCheck.error }, { status });
  }

  const orgGuard = await assertOrgActive(orgId);
  if (!orgGuard.ok) {
    return NextResponse.json({ ok: false, error: orgGuard.error }, { status: 403 });
  }

  const agentGuard = await assertAgentRunnable(orgId, parsed.data.agentType);
  if (!agentGuard.ok) {
    return NextResponse.json({ ok: false, error: agentGuard.error }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  const { runId } = await enqueueJob("chat_request", {
    orgId,
    agentType: parsed.data.agentType,
    input: { message: parsed.data.message },
    idempotencyKey,
  });

  return NextResponse.json({ ok: true, data: { runId, status: "queued" } }, { status: 202 });
}
