"use client";

import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  ORG_NAV_GROUP,
  PLATFORM_NAV_GROUP,
  PRIMARY_NAV_GROUP,
} from "@/components/app-shell/nav-config";

const ALL_ITEMS = [...PRIMARY_NAV_GROUP.items, ...ORG_NAV_GROUP.items, ...PLATFORM_NAV_GROUP.items];

/** Solo cubre las páginas que están en el sidebar — una ruta más profunda (p. ej. el chat de un
 * agente custom) no tiene entrada y no muestra breadcrumb en vez de mostrar algo incorrecto. */
export function TopbarBreadcrumb({ orgName }: { orgName: string }) {
  const pathname = usePathname();
  const current = ALL_ITEMS.find((item) =>
    item.href === "/app"
      ? pathname === "/app"
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (!current) return null;

  return (
    <div className="flex items-center gap-1.5 px-6 pt-2.5 text-sm text-muted-foreground">
      <span>{orgName}</span>
      <ChevronRight className="size-3.5" />
      <span className="font-semibold text-foreground">{current.label}</span>
    </div>
  );
}
