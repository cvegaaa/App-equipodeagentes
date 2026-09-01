import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { weeklyReport } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { requireMembership } from "@/server/permissions";

export const metadata = { title: "Reportes — GEIFEM Agentes" };

export default async function ReportesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();

  // El link siempre apunta a la fila audience='client' del periodo — la distinción por rol la
  // resuelve la página de detalle (nunca se filtra "a mano" en el cliente qué puede ver un viewer).
  const reports = await db
    .select()
    .from(weeklyReport)
    .where(and(eq(weeklyReport.orgId, activeOrg.orgId), eq(weeklyReport.audience, "client")))
    .orderBy(desc(weeklyReport.periodStart));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          Resumen semanal de lo que hizo el Aux Contable en {activeOrg.orgName}.
        </p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Todavía no hay reportes — el primero llega el próximo lunes.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Link key={report.id} href={`/app/reportes/${report.id}`}>
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex items-center justify-between pt-6">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {new Date(report.periodStart).toLocaleDateString("es-CO")} —{" "}
                      {new Date(report.periodEnd).toLocaleDateString("es-CO")}
                    </p>
                    <p className="line-clamp-1 text-sm text-muted-foreground">{report.content}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
