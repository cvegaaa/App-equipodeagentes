import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { InviteMemberForm } from "@/components/miembros/invite-member-form";
import { MemberRow } from "@/components/miembros/member-row";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { membership, user as userTable } from "@/lib/db/schema";
import { resolveActiveOrg } from "@/server/active-org";
import { requireMembership } from "@/server/permissions";

export const metadata = { title: "Miembros — GEIFEM Agentes" };

export default async function MiembrosPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const activeOrg = await resolveActiveOrg(session.user.id);
  if (!activeOrg) notFound();

  const membershipCheck = await requireMembership(session.user.id, activeOrg.orgId);
  if (!membershipCheck.ok) notFound();

  const canManage = membershipCheck.data.role === "owner";

  const members = await db
    .select({
      id: membership.id,
      role: membership.role,
      acceptedAt: membership.acceptedAt,
      email: userTable.email,
      name: userTable.name,
    })
    .from(membership)
    .innerJoin(userTable, eq(userTable.id, membership.userId))
    .where(eq(membership.orgId, activeOrg.orgId));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Miembros</h1>
        <p className="text-sm text-muted-foreground">Personas con acceso a {activeOrg.orgName}.</p>
      </div>

      {canManage && (
        <Card>
          <CardContent className="pt-6">
            <InviteMemberForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                {canManage && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={{ ...member, role: member.role as "owner" | "operator" }}
                  canManage={canManage}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
