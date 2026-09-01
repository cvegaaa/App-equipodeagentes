"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LogoutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleLogout() {
    setIsSigningOut(true);
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} disabled={isSigningOut}>
      <LogOut className="size-4" />
      Cerrar sesión
    </Button>
  );
}
