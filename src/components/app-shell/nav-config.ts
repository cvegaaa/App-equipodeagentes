import {
  Activity,
  Bot,
  Building2,
  FileText,
  Home,
  type LucideIcon,
  Plug,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string; items: NavItem[] };

// Agrupado por lo que el usuario hace con cada sección, no por orden de construcción — ver
// docs/rediseno-panel-2026-08.md. Compartido entre AppSidebar (navegación) y TopbarBreadcrumb
// (ubicación) para que ambos coincidan siempre.
//
// "Chat" y "Configuración del agente" ya NO son destinos propios — viven dentro del workspace de
// cada agente (/app/agentes/[agentType]/{,configuracion,conectores}), no como páginas globales
// ambiguas sobre "cuál agente". Seleccionar un agente en /app/agentes es la única puerta de
// entrada a su chat y su configuración.
export const PRIMARY_NAV_GROUP: NavGroup = {
  label: "Principal",
  items: [
    { href: "/app", label: "Inicio", icon: Home },
    { href: "/app/agentes", label: "Agentes", icon: Bot },
    { href: "/app/copiloto", label: "Copiloto", icon: Sparkles },
    { href: "/app/reportes", label: "Reportes", icon: FileText },
  ],
};

export const ORG_NAV_GROUP: NavGroup = {
  label: "Organización",
  items: [
    { href: "/app/miembros", label: "Miembros", icon: Users },
    { href: "/app/conexiones", label: "Conexiones", icon: Plug },
  ],
};

export const PLATFORM_NAV_GROUP: NavGroup = {
  label: "Plataforma",
  items: [
    { href: "/app/organizaciones", label: "Organizaciones", icon: Building2 },
    { href: "/app/plataforma/usuarios", label: "Usuarios", icon: ShieldCheck },
    { href: "/app/observabilidad", label: "Observabilidad", icon: Activity },
  ],
};
