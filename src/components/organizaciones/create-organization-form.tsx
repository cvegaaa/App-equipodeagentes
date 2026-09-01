"use client";

import { useActionState } from "react";
import { createOrganizationAction } from "@/app/app/organizaciones/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateOrganizationForm() {
  const [state, formAction, isPending] = useActionState(createOrganizationAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-2">
        <Label htmlFor="name">Nombre de la organización</Label>
        <Input id="name" name="name" required placeholder="Panadería Doña Lucía" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Creando…" : "Crear organización"}
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive sm:basis-full">
          {state.error}
        </p>
      )}
    </form>
  );
}
