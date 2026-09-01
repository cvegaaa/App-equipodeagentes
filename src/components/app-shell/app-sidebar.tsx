"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ORG_NAV_GROUP,
  PLATFORM_NAV_GROUP,
  PRIMARY_NAV_GROUP,
} from "@/components/app-shell/nav-config";
import { cn } from "@/lib/utils";

const COLLAPSE_STORAGE_KEY = "app_sidebar_collapsed";

function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Preferencia por navegador — nunca bloquea el primer render con un valor del servidor que no
  // conoce esto (es puramente client-side, igual que el resto de app-shell).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // localStorage no disponible (navegación privada, etc.) — se queda expandido.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // no persiste, pero el toggle en esta sesión igual funciona.
      }
      return next;
    });
  }

  const groups = isPlatformAdmin
    ? [PRIMARY_NAV_GROUP, ORG_NAV_GROUP, PLATFORM_NAV_GROUP]
    : [PRIMARY_NAV_GROUP, ORG_NAV_GROUP];

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150 md:flex",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <div className="size-7 shrink-0 rounded-md bg-gradient-to-br from-primary to-chart-2" />
        {!collapsed && (
          <span className="truncate text-sm font-bold text-foreground">GEIFEM Agentes</span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2.5">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                {group.label}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActiveHref(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border-l-[3px] border-transparent py-2 pr-2.5 pl-[7px] text-sm font-medium text-foreground hover:bg-muted",
                      collapsed && "justify-center",
                      active &&
                        "border-primary bg-primary/10 font-semibold text-primary hover:bg-primary/10",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-[18px] shrink-0 text-muted-foreground",
                        active && "text-primary",
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-2.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          className="flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft
            className={cn("size-4 transition-transform duration-150", collapsed && "rotate-180")}
          />
          {!collapsed && "Colapsar"}
        </button>
      </div>
    </aside>
  );
}
