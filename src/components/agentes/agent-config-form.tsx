"use client";

import { useActionState } from "react";
import { updateAuxContableConfigAction } from "@/app/app/agentes/[agentType]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function AgentConfigForm({
  canEdit,
  enabled,
  soporteThresholdCents,
  tone,
  businessDescription,
}: {
  canEdit: boolean;
  enabled: boolean;
  soporteThresholdCents: number;
  tone: string;
  businessDescription: string;
}) {
  const [state, formAction, isPending] = useActionState(updateAuxContableConfigAction, null);

  return (
    <form action={formAction} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="enabled">Agente habilitado</Label>
          <p className="text-sm text-muted-foreground">
            Si está apagado, no se crean nuevos runs para esta organización.
          </p>
        </div>
        <Switch id="enabled" name="enabled" defaultChecked={enabled} disabled={!canEdit} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="businessDescription">A qué se dedica la empresa</Label>
        <p className="text-sm text-muted-foreground">
          Contexto de negocio que el agente tiene en cuenta al responder — p. ej. "somos una
          panadería con dos sucursales, vendemos al por menor y a restaurantes".
        </p>
        <Textarea
          id="businessDescription"
          name="businessDescription"
          defaultValue={businessDescription}
          placeholder="Describe brevemente la actividad de la empresa…"
          disabled={!canEdit}
          className="min-h-[80px]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tone">Tono esperado en las respuestas</Label>
        <p className="text-sm text-muted-foreground">
          P. ej. "cercano y directo", "formal", "como si le hablara a un socio".
        </p>
        <Input
          id="tone"
          name="tone"
          defaultValue={tone}
          placeholder="Cercano y directo"
          disabled={!canEdit}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="soporteThresholdCents">Umbral de soporte (centavos)</Label>
        <p className="text-sm text-muted-foreground">
          Documentos por encima de este monto exigen revisar el soporte adjunto en Alegra antes de
          continuar.
        </p>
        <Input
          id="soporteThresholdCents"
          name="soporteThresholdCents"
          type="number"
          min={0}
          step={1}
          defaultValue={soporteThresholdCents}
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
          {state?.ok && <p className="text-sm text-success">Configuración guardada.</p>}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </>
      )}
    </form>
  );
}
