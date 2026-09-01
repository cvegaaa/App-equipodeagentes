import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { WelcomeForm } from "@/components/bienvenida/welcome-form";
import { auth } from "@/lib/auth";
import { listAcceptedMemberships } from "@/server/active-org";

export const metadata = { title: "Bienvenido — GEIFEM Agentes" };

// Fuera del árbol de /app/app (que redirige aquí cuando no hay membresías) — así este paso no
// hereda ese mismo layout ni entra en loop de redirección.
export default async function BienvenidaPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const memberships = await listAcceptedMemberships(session.user.id);
  if (memberships.length > 0) redirect("/app");

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-foreground">Bienvenido a GEIFEM Agentes</h1>
          <p className="text-sm text-muted-foreground">
            Antes de empezar, dale un nombre a tu espacio de trabajo.
          </p>
        </div>
        <WelcomeForm />
      </div>
    </main>
  );
}
