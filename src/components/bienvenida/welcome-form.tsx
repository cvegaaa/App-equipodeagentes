"use client";

import { useActionState } from "react";
import { createPersonalWorkspaceAction } from "@/app/bienvenida/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WelcomeForm() {
  const [state, formAction, isPending] = useActionState(createPersonalWorkspaceAction, null);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="space-y-2">
        <Label htmlFor="name">Nombre de tu espacio de trabajo</Label>
        <Input id="name" name="name" placeholder="Mi negocio" required autoFocus />
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Creando…" : "Empezar"}
      </Button>
    </form>
  );
}
