"use client";

import { useActionState } from "react";
import { updateWhatsappNumberAction } from "@/app/app/agentes/[agentType]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WhatsappNumberForm({
  canEdit,
  whatsappNumber,
}: {
  canEdit: boolean;
  whatsappNumber: string;
}) {
  const [state, formAction, isPending] = useActionState(updateWhatsappNumberAction, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="whatsappNumber">Número de WhatsApp del cliente</Label>
        <p className="text-sm text-muted-foreground">
          El agente responde a los mensajes que lleguen desde este número. Formato E.164 sin "+" —
          ej. 573001234567.
        </p>
        <Input
          id="whatsappNumber"
          name="whatsappNumber"
          defaultValue={whatsappNumber}
          placeholder="573001234567"
          disabled={!canEdit}
        />
      </div>

      {canEdit && (
        <>
          {state && !state.ok && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state?.ok && <p className="text-sm text-success">Número guardado.</p>}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar número"}
          </Button>
        </>
      )}
    </form>
  );
}
