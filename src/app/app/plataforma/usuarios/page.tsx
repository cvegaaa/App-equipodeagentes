import { desc } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SuperadminToggle } from "@/components/plataforma/superadmin-toggle";
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
import { user } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/server/permissions";

export const metadata = { title: "Usuarios — GEIFEM Agentes" };

export default async function UsuariosPlataformaPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const guard = await requirePlatformAdmin(session.user.id);
  if (!guard.ok) notFound();

  const users = await db
    .select({ id: user.id, email: user.email, name: user.name, platformRole: user.platformRole })
    .from(user)
    .orderBy(desc(user.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          Todas las cuentas de la plataforma — promueve o quita superadmins desde acá.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol de plataforma</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isSuperadmin = u.platformRole === "platform_admin";
                return (
                  <TableRow key={u.id}>
                    <TableCell>{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={isSuperadmin ? "default" : "secondary"}>
                        {isSuperadmin ? "Superadmin" : "Usuario"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <SuperadminToggle userId={u.id} isSuperadmin={isSuperadmin} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
