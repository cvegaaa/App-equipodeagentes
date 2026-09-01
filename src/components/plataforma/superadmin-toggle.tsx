"use client";

import { useState, useTransition } from "react";
import { toggleSuperadminAction } from "@/app/app/plataforma/usuarios/actions";
import { Button } from "@/components/ui/button";

export function SuperadminToggle({
  userId,
  isSuperadmin,
}: {
  userId: string;
  isSuperadmin: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await toggleSuperadminAction(userId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={isSuperadmin ? "outline" : "secondary"}
        size="sm"
        onClick={handleClick}
        disabled={isPending}
      >
        {isSuperadmin ? "Quitar superadmin" : "Hacer superadmin"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
