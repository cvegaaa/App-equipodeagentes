"use client";

import { useActionState, useState } from "react";
import { saveConnectionAction } from "@/app/app/conexiones/actions";
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

export function ConnectionForm() {
  const [state, formAction, isPending] = useActionState(saveConnectionAction, null);
  const [authType, setAuthType] = useState<"bearer_token" | "api_key_header" | "basic">("basic");

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="providerKey">Proveedor</Label>
        <Input id="providerKey" name="providerKey" defaultValue="alegra" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseUrl">URL base</Label>
        <Input
          id="baseUrl"
          name="baseUrl"
          type="url"
          placeholder="https://api.alegra.com/api/v1"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="authType">Tipo de autenticación</Label>
        <Select
          defaultValue={authType}
          onValueChange={(value) => setAuthType(value as typeof authType)}
        >
          <SelectTrigger id="authType" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="basic">Basic (usuario:token)</SelectItem>
            <SelectItem value="bearer_token">Bearer token</SelectItem>
            <SelectItem value="api_key_header">Header de API key</SelectItem>
          </SelectContent>
        </Select>
        {/* Select de shadcn no envía su valor como <select> nativo — replicamos el valor elegido */}
        <input type="hidden" name="authType" value={authType} />
      </div>

      {authType === "api_key_header" && (
        <div className="space-y-2">
          <Label htmlFor="authHeaderName">Nombre del header</Label>
          <Input id="authHeaderName" name="authHeaderName" placeholder="X-Api-Key" />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="token">
          {authType === "basic" ? "usuario:token (se cifra antes de guardarse)" : "Token"}
        </Label>
        <Input id="token" name="token" type="password" required autoComplete="off" />
      </div>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && <p className="text-sm text-success">Conexión guardada.</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar conexión"}
      </Button>
    </form>
  );
}
