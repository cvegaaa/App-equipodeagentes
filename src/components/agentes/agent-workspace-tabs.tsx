"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { slug: "", label: "Chat" },
  { slug: "/configuracion", label: "Configuración" },
  { slug: "/conectores", label: "Conectores" },
];

export function AgentWorkspaceTabs({ basePath }: { basePath: string }) {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b border-border" role="tablist">
      {TABS.map((tab) => {
        const href = `${basePath}${tab.slug}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            role="tab"
            aria-selected={active}
            className={cn(
              "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground",
              active && "border-primary font-semibold text-primary",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
