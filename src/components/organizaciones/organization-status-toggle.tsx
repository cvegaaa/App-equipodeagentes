"use client";

import { useTransition } from "react";
import { toggleOrganizationStatusAction } from "@/app/app/organizaciones/actions";
import { Button } from "@/components/ui/button";

export function OrganizationStatusToggle({
  orgId,
  status,
}: {
  orgId: string;
  status: "active" | "blocked";
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(() => {
      toggleOrganizationStatusAction(orgId);
    });
  }

  return (
    <Button
      variant={status === "active" ? "outline" : "secondary"}
      size="sm"
      onClick={handleClick}
      disabled={isPending}
    >
      {status === "active" ? "Bloquear" : "Desbloquear"}
    </Button>
  );
}
