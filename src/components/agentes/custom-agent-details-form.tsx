"use client";

import { useActionState } from "react";
import { updateCustomAgentDetailsAction } from "@/app/app/agentes/[agentType]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CustomAgentDetailsForm({
  customAgentId,
  canEdit,
  name,
  description,
  systemPrompt,
}: {
  customAgentId: string;
  canEdit: boolean;
  name: string;
  description: string;
  systemPrompt: string;
}) {
  const [state, formAction, isPending] = useActionState(updateCustomAgentDetailsAction, null);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="customAgentId" value={customAgentId} />
        <div className="space-y-2">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" name="name" defaultValue={name} disabled={!canEdit} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Descripción</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={description}
            disabled={!canEdit}
            className="min-h-[70px]"
          />
        </div>
        {canEdit && (
          <>
            {state && !state.ok && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
            {state?.ok && <p className="text-sm text-success">Guardado.</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </>
        )}
      </form>

      <div className="space-y-2">
        <Label>System prompt</Label>
        <p className="text-sm text-muted-foreground">
          Generado por el copiloto a partir de la entrevista — para cambiarlo, continúa la
          conversación en <span className="font-medium text-foreground">Copiloto</span> en vez de
          editarlo aquí directamente.
        </p>
        <pre className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">
          {systemPrompt}
        </pre>
      </div>
    </div>
  );
}
