import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { weeklyReport } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { requireMembership } from "@/server/permissions";

export const metadata = { title: "Reporte semanal — GEIFEM Agentes" };

export default async function ReporteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();

  const [requested] = await db.select().from(weeklyReport).where(eq(weeklyReport.id, id));
  // Recurso de otra organización -> 404, nunca 403 (no confirma existencia — blueprint §8).
  if (!requested || requested.orgId !== activeOrg.orgId) notFound();

  const isUsuario = membershipCheck.data.role === "operator";

  // Un 'usuario' (no admin) nunca ve el contenido audience='operator' — si el id solicitado es
  // ese, se sustituye por la fila 'client' del mismo periodo, nunca se le muestra la versión
  // interna. Nota: audience='operator' es un valor de weeklyReport, sin relación con el rol de
  // membership del mismo nombre — coincidencia de nombres del diseño original, no el mismo dato.
  const report =
    isUsuario && requested.audience === "operator"
      ? await db
          .select()
          .from(weeklyReport)
          .where(
            and(
              eq(weeklyReport.orgId, activeOrg.orgId),
              eq(weeklyReport.periodStart, requested.periodStart),
              eq(weeklyReport.audience, "client"),
            ),
          )
          .then((rows) => rows[0])
      : requested;

  if (!report) notFound();

  const siblingAudience = report.audience === "client" ? "operator" : "client";
  const [sibling] =
    membershipCheck.data.role === "owner"
      ? await db
          .select({ id: weeklyReport.id })
          .from(weeklyReport)
          .where(
            and(
              eq(weeklyReport.orgId, activeOrg.orgId),
              eq(weeklyReport.periodStart, report.periodStart),
              eq(weeklyReport.audience, siblingAudience),
            ),
          )
      : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Reporte del {new Date(report.periodStart).toLocaleDateString("es-CO")} al{" "}
            {new Date(report.periodEnd).toLocaleDateString("es-CO")}
          </h1>
          <Badge variant="secondary" className="mt-1">
            {report.audience === "client" ? "Vista cliente" : "Vista interna (operator)"}
          </Badge>
        </div>
        {sibling && (
          <Link href={`/app/reportes/${sibling.id}`} className="text-sm text-primary underline">
            Ver {siblingAudience === "operator" ? "versión interna" : "versión cliente"}
          </Link>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="whitespace-pre-wrap text-sm text-foreground">{report.content}</p>
        </CardContent>
      </Card>
    </div>
  );
}
