import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="text-xl font-semibold text-foreground">No tienes acceso a esta página</h1>
      <p className="text-sm text-muted-foreground">
        Esta sección es solo para administradores de GEIFEM.
      </p>
      <Link
        href="/app"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Volver al panel
      </Link>
    </div>
  );
}
