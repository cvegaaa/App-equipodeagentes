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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
