# GEIFEM Agentes

Panel de agentes de IA para GEIFEM: automatiza atención al cliente por WhatsApp y Telegram, y tareas contables conectadas a Alegra.

## Qué resuelve

Da a un equipo un panel con organizaciones, miembros y agentes configurables que responden por WhatsApp/Telegram, generan reportes periódicos y se conectan al ERP contable Alegra para automatizar tareas administrativas.

## Funcionalidades principales

- Chat entrante/saliente por WhatsApp Business Cloud API y Telegram.
- Conectores a proveedores externos (Alegra) para operaciones contables.
- Panel de observabilidad y monitoreo de tareas en ejecución.
- Reportes periódicos automáticos (cron jobs).
- Gestión de organizaciones y miembros con roles.

## Stack técnico

- Next.js (App Router) + TypeScript
- PostgreSQL vía Drizzle ORM
- better-auth
- Modelo de lenguaje vía API de Anthropic (Claude)
- Docker / docker-compose
- Playwright (tests end-to-end), Biome (lint/format)

## Estado

En desarrollo.
