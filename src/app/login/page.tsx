import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión — GEIFEM Agentes",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-foreground">GEIFEM Agentes</h1>
          <p className="text-sm text-muted-foreground">Inicia sesión para continuar</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
