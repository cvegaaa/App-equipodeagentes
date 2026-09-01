"use client";

import { useTransition } from "react";
import { removeMemberAction } from "@/app/app/miembros/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

type Member = {
  id: string;
  role: "owner" | "operator";
  acceptedAt: Date | null;
  email: string;
  name: string;
};

const ROLE_LABEL: Record<Member["role"], string> = { owner: "Administrador", operator: "Usuario" };

export function MemberRow({ member, canManage }: { member: Member; canManage: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(() => {
      removeMemberAction(member.id);
    });
  }

  return (
    <TableRow>
      <TableCell>{member.name}</TableCell>
      <TableCell className="text-muted-foreground">{member.email}</TableCell>
      <TableCell>
        <Badge variant={member.role === "owner" ? "default" : "secondary"}>
          {ROLE_LABEL[member.role]}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {member.acceptedAt ? "Activo" : "Invitación pendiente"}
      </TableCell>
      {canManage && (
        <TableCell className="text-right">
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={isPending}>
            Quitar
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}
