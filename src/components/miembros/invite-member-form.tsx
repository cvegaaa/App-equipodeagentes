"use client";

import { useActionState, useState } from "react";
import { inviteMemberAction } from "@/app/app/miembros/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function InviteMemberForm() {
  const [state, formAction, isPending] = useActionState(inviteMemberAction, null);
  const [role, setRole] = useState<"operator" | "owner">("operator");

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-2">
        <Label htmlFor="email">Correo de la persona</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="role">Rol</Label>
        <Select defaultValue={role} onValueChange={(value) => setRole(value as typeof role)}>
          <SelectTrigger id="role" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="operator">Usuario</SelectItem>
            <SelectItem value="owner">Administrador</SelectItem>
          </SelectContent>
        </Select>
        <input type="hidden" name="role" value={role} />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Invitando…" : "Invitar"}
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive sm:basis-full">
          {state.error}
        </p>
      )}
    </form>
  );
}
