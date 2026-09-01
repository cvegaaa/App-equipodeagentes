import { and, desc, eq, gte } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfig, runs, weeklyReport } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { requireMembership } from "@/server/permissions";

export const metadata = { title: "Inicio — GEIFEM Agentes" };

const STATUS_LABEL: Record<string, string> = {
  queued: "En cola",
  running: "En curso",
  succeeded: "Exitoso",
  failed: "Fallido",
  cancelled: "Cancelado",
  budget_exceeded: "Presupuesto excedido",
};

export default async function InicioPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">Bienvenido a GEIFEM Agentes</h1>
        <p className="text-sm text-muted-foreground">
          Todavía no perteneces a ninguna organización — pídele a un administrador que te invite.
        </p>
      </div>
    );
  }

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [config, recentRuns, [latestReport]] = await Promise.all([
    db
      .select()
      .from(agentConfig)
      .where(eq(agentConfig.orgId, activeOrg.orgId))
      .then((r) => r[0]),
    db
      .select()
      .from(runs)
      .where(and(eq(runs.orgId, activeOrg.orgId), gte(runs.createdAt, sevenDaysAgo)))
      .orderBy(desc(runs.createdAt)),
    db
      .select()
      .from(weeklyReport)
      .where(and(eq(weeklyReport.orgId, activeOrg.orgId), eq(weeklyReport.audience, "client")))
      .orderBy(desc(weeklyReport.periodStart))
      .limit(1),
  ]);

  const succeeded = recentRuns.filter((r) => r.status === "succeeded").length;
  const needsAttention = recentRuns.filter(
    (r) => r.status === "failed" || r.status === "budget_exceeded",
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Hola de nuevo</h1>
        <p className="text-sm text-muted-foreground">
          Esto es lo que hizo el Aux Contable en {activeOrg.orgName} esta semana.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Estado del agente</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={config?.enabled ? "default" : "secondary"}>
              {config?.enabled ? "Habilitado" : "Deshabilitado"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Gestiones esta semana</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{succeeded}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Necesitan atención</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{needsAttention}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Último reporte semanal</CardTitle>
        </CardHeader>
        <CardContent>
          {latestReport ? (
            <Link
              href={`/app/reportes/${latestReport.id}`}
              className="text-sm text-primary underline"
            >
              Ver reporte del {new Date(latestReport.periodStart).toLocaleDateString("es-CO")}
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">
              Todavía no hay reportes — el primero llega el próximo lunes.
            </p>
          )}
        </CardContent>
      </Card>

      {recentRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Actividad reciente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentRuns.slice(0, 5).map((run) => (
              <div key={run.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {run.createdAt.toLocaleString("es-CO")}
                </span>
                <Badge variant="secondary">{STATUS_LABEL[run.status] ?? run.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
