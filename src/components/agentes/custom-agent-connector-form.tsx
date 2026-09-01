"use client";

import { useActionState } from "react";
import { updateCustomAgentConnectorAction } from "@/app/app/agentes/[agentType]/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function CustomAgentConnectorForm({
  customAgentId,
  canEdit,
  connectorId,
  options,
}: {
  customAgentId: string;
  canEdit: boolean;
  connectorId: string | null;
  options: { id: string; label: string }[];
}) {
  const [state, formAction, isPending] = useActionState(updateCustomAgentConnectorAction, null);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customAgentId" value={customAgentId} />
      <div className="space-y-2">
        <Label htmlFor="connectorId">Conector</Label>
        <p className="text-sm text-muted-foreground">
          Conectores curados (Alegra) o propios (REST autoservicio) — MCP todavía no está soportado.
        </p>
        <select
          id="connectorId"
          name="connectorId"
          defaultValue={connectorId ?? ""}
          disabled={!canEdit || options.length === 0}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">Sin conector</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {options.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Esta organización todavía no tiene conectores — conecta uno desde{" "}
            <a href="/app/conexiones" className="font-medium text-primary hover:underline">
              Conexiones
            </a>
            .
          </p>
        )}
      </div>

      {canEdit && (
        <>
          {state && !state.ok && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state?.ok && <p className="text-sm text-success">Conector actualizado.</p>}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </>
      )}
    </form>
  );
}
