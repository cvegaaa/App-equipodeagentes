import { desc, eq, gte, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { forbidden, notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { organization, runs } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/server/permissions";

export const metadata = { title: "Observabilidad — GEIFEM Agentes" };

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled", "budget_exceeded"] as const;

export default async function ObservabilidadPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const guard = await requirePlatformAdmin(session.user.id);
  if (!guard.ok) forbidden();

  const since = new Date(Date.now() - SEVEN_DAYS_MS);

  const statusCounts = await db
    .select({ status: runs.status, count: sql<number>`count(*)::int` })
    .from(runs)
    .where(gte(runs.createdAt, since))
    .groupBy(runs.status);

  const terminalTotal = statusCounts
    .filter((row) => (TERMINAL_STATUSES as readonly string[]).includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  const succeededTotal = statusCounts.find((row) => row.status === "succeeded")?.count ?? 0;
  const successRate =
    terminalTotal === 0 ? null : Math.round((succeededTotal / terminalTotal) * 100);

  const recentRuns = await db
    .select({
      id: runs.id,
      orgName: organization.name,
      triggerType: runs.triggerType,
      status: runs.status,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .innerJoin(organization, eq(organization.id, runs.orgId))
    .where(gte(runs.createdAt, since))
    .orderBy(desc(runs.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Observabilidad</h1>
        <p className="text-sm text-muted-foreground">
          Actividad del agente en los últimos 7 días, todas las organizaciones.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tasa de éxito
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">
              {successRate === null ? "—" : `${successRate}%`}
            </p>
            <p className="text-sm text-muted-foreground">
              {succeededTotal} de {terminalTotal} runs terminados
            </p>
          </CardContent>
        </Card>

        {statusCounts.map((row) => (
          <Card key={row.status}>
            <CardHeader>
              <CardTitle className="text-sm font-medium capitalize text-muted-foreground">
                {row.status}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-foreground">{row.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Runs recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin runs en los últimos 7 días.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organización</TableHead>
                  <TableHead>Disparador</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{run.orgName}</TableCell>
                    <TableCell className="text-muted-foreground">{run.triggerType}</TableCell>
                    <TableCell className="text-muted-foreground">{run.status}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.createdAt.toLocaleString("es-CO")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
