# GEIFEM Agentes — instrucciones para agentes

Plataforma SaaS multi-tenant: auxiliar contable autónomo (IA) sobre Alegra para clientes de GEIFEM.

## Comandos

| Tarea | Comando |
|---|---|
| Instalar | `pnpm install` |
| Dev | `pnpm dev` |
| Build | `pnpm build` |
| Typecheck | `pnpm exec tsc --noEmit` |
| Lint | `pnpm exec biome check .` |
| Tests | `pnpm exec vitest run` |
| E2E | `pnpm exec playwright test` |
| Migrar DB | `pnpm exec drizzle-kit migrate` |

## No negociable

1. Ninguna escritura a Alegra ocurre sin una fila `tool_calls` persistida ANTES de ejecutarse, con `idempotency_key`.
2. El soporte audit nunca corre en runs `trigger_type = 'dian_sync'` — verificado en código.
3. Toda mutación pasa por `authorize(actor, action, resource)`.
4. Las credenciales de Alegra se cifran (AES-256-GCM) antes de tocar disco.
5. Nunca commitear secretos, `.env`, ni output de build generado.
6. Nunca editar a mano archivos generados (migraciones, lockfile).
7. Nunca marcar una tarea como terminada con un comando de gate en rojo.

Arquitectura completa, fronteras y tokens de diseño: ver `CLAUDE.md` en este mismo directorio.
