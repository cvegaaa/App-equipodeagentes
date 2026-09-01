"use client";

import { useActionState } from "react";
import { updateTelegramChatIdAction } from "@/app/app/agentes/[agentType]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TelegramChatIdForm({
  canEdit,
  telegramChatId,
}: {
  canEdit: boolean;
  telegramChatId: string;
}) {
  const [state, formAction, isPending] = useActionState(updateTelegramChatIdAction, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="telegramChatId">Chat de Telegram del cliente</Label>
        <p className="text-sm text-muted-foreground">
          Pide al cliente que le escriba primero al bot de GEIFEM en Telegram, y copia aquí el
          chat.id que aparece en el mensaje recibido.
        </p>
        <Input
          id="telegramChatId"
          name="telegramChatId"
          defaultValue={telegramChatId}
          placeholder="123456789"
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
          {state?.ok && <p className="text-sm text-success">Chat guardado.</p>}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar chat"}
          </Button>
        </>
      )}
    </form>
  );
}
