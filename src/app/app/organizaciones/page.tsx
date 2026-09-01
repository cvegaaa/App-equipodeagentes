import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CreateOrganizationForm } from "@/components/organizaciones/create-organization-form";
import { OrganizationStatusToggle } from "@/components/organizaciones/organization-status-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { organization } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/server/permissions";

export const metadata = { title: "Organizaciones — GEIFEM Agentes" };

export default async function OrganizacionesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const guard = await requirePlatformAdmin(session.user.id);
  if (!guard.ok) notFound();

  const organizations = await db.select().from(organization).orderBy(organization.createdAt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Organizaciones</h1>
        <p className="text-sm text-muted-foreground">
          Clientes de GEIFEM con acceso a la plataforma.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <CreateOrganizationForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay organizaciones creadas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>{org.name}</TableCell>
                    <TableCell className="text-muted-foreground">{org.slug}</TableCell>
                    <TableCell>
                      <Badge variant={org.status === "active" ? "default" : "destructive"}>
                        {org.status === "active" ? "Activa" : "Bloqueada"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {org.createdAt.toLocaleDateString("es-CO")}
                    </TableCell>
                    <TableCell className="text-right">
                      <OrganizationStatusToggle
                        orgId={org.id}
                        status={org.status as "active" | "blocked"}
                      />
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
