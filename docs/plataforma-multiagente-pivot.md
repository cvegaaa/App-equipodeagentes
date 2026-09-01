# Pivote: de "SaaS de un agente" a "plataforma de agentes"

Decisión del dueño del proyecto, 2026-08-27. Reemplaza la premisa de `blueprint.md` §1 ("un único
agente Aux Contable, prompt fijo en código, compartido por todos los clientes"). Este documento es
la fuente de verdad del nuevo diseño hasta que se vuelque a una revisión formal de `blueprint.md`.

## 1. Visión

GEIFEM Agentes deja de ser "el auxiliar contable de GEIFEM sobre Alegra" y pasa a ser una
**plataforma multi-tenant sobre la que cualquier organización puede tener varios agentes de IA**,
cada uno conectado a aplicaciones externas vía API REST. GEIFEM/Alegra/Aux Contable es el primer
caso de uso, no el negocio central — queda como el primer agente del catálogo, sin cambios en su
comportamiento.

Dos caminos para que una organización tenga un agente, no mutuamente excluyentes:

1. **Elegir del catálogo** — agentes predefinidos que GEIFEM construye y mantiene en código (como
   Aux Contable hoy), listos para activar y conectar.
2. **Crear uno propio** — un asistente conversacional (el "agent builder") entrevista al usuario
   sobre qué necesita, qué aplicación externa ya tiene conectada y qué debe poder hacer el agente, y
   arma la definición del agente **como datos**, sin escribir código ni desplegar nada nuevo.

## 2. Por qué esto es un cambio menor de lo que parece

`src/server/agent/loop.ts` y `src/lib/connectors/rest-client.ts` **ya son genéricos** — el loop
resuelve `AgentDefinition` por `agentType` desde un `Map` (`registerAgentDefinition`), y el cliente
REST no conoce Alegra. Lo único atado a un solo agente es:

- El `CHECK` de `agent_config.agent_type` que solo permite `'aux_contable'`.
- `agent_config.org_id` es `UNIQUE` → una organización solo puede tener una fila de config, es decir
  un agente.
- El catálogo de agentes (hoy solo Aux Contable) vive únicamente en código, registrado al importar
  `agent/<tipo>/definition.ts` — no hay forma de definir un agente sin escribir ese módulo.
- No existe ningún concepto de "agente creado por el usuario" en el modelo de datos.

El pivote es sobre todo: **modelo de datos + un `AgentDefinition` dinámico para agentes custom +
panel**. El loop de ejecución (persistir `tool_calls` antes de ejecutar, presupuesto de steps,
recuperación de steps interrumpidos) no cambia.

## 3. Modelo de datos — delta

### `agent_config` (existente, se relaja)

- Quitar `unique(org_id)` → `unique(org_id, agent_type)`. Una organización puede tener una fila por
  agente activo (catálogo o custom).
- Quitar el `CHECK agent_config_agent_type_check` (`in ('aux_contable')`). La validación de que
  `agent_type` es un agente resoluble pasa a ser responsabilidad de código
  (`resolveAgentDefinition` en `loop.ts`, que ya lanza si no encuentra definición) — igual que hoy
  se valida `provider_key` sin `CHECK`.
- Migración es aditiva y sin downtime: las filas existentes (`agent_type='aux_contable'`, una por
  org) ya cumplen la nueva unique constraint.

### `custom_agents` (nueva tabla)

La "receta" de un agente creado por un usuario vía el wizard — separada de `agent_config` (que
sigue siendo enable/schedule/business_rules, ahora por-agente-por-org):

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid, FK `organization`, not null, índice | dueño del tenant |
| `created_by_user_id` | text, FK `user` | quién lo creó, para `audit_log` |
| `name` | text not null | nombre que el usuario le dio |
| `description` | text not null | resumen para el catálogo/picker |
| `system_prompt` | text not null | ensamblado por el wizard a partir de la entrevista — nunca editado a mano libre por el usuario en v1 (ver §6) |
| `provider_key` | text not null | qué `app_connections.provider_key` usa este agente — **uno solo por agente en v1**, igual que `AgentDefinition.providerKey` hoy |
| `enabled_tool_names` | jsonb not null default `[]` | subconjunto de nombres de tool del registro de ese `provider_key` que el agente puede invocar |
| `status` | text not null default `'draft'` | `check in ('draft','active','archived')` — el wizard puede dejarlo en `draft` mientras se itera |
| `created_at`, `updated_at` | timestamptz | |

`agent_type` para un custom agent en `runs`/`agent_config` es `` `custom:${custom_agents.id}` `` —
ningún cambio de tipo en esas columnas (ya son `text`).

### Catálogo de agentes — sin tabla nueva

El catálogo (Aux Contable + futuros agentes de código) sigue siendo el `Map` en memoria de
`loop.ts`. Se le agregan campos de metadata a `AgentDefinition` (`displayName`, `description`,
`icon`) para que el panel pueda listar `Object.values(agentDefinitions)` sin una tabla espejo — no
se justifica una tabla que duplicaría lo que el código ya declara (regla 10, ninguna dependencia sin
razón).

## 4. `AgentDefinition` dinámica para agentes custom

`loop.ts` resuelve hoy `resolveAgentDefinition(agentType)` solo contra el `Map` de agentes
registrados en código. Se extiende así:

```
resolveAgentDefinition(agentType):
  si agentType empieza con "custom:"
    → cargar la fila custom_agents (id extraído del agentType)
    → construir un AgentDefinition en memoria:
        systemPrompt = fila.system_prompt (string fijo, no función)
        tools = filtrar getToolRegistry(fila.provider_key) a fila.enabled_tool_names
        providerKey = fila.provider_key
        maxSteps / maxTokensPerCall = defaults de plataforma (mismos que Aux Contable hoy,
          ajustables después vía agent_config si hace falta)
  si no
    → Map existente (comportamiento actual, sin cambios)
```

No se toca `getToolRegistry` ni `rest-client.ts` — un agente custom solo puede usar tools que ya
existan en un `providers/<provider_key>/` construido por GEIFEM. Esto es una limitación deliberada
de v1 (ver no-objetivos).

## 5. El "agent builder" — copiloto de plataforma, no un agente del catálogo

Corrección sobre la primera versión de este documento: el `agent_builder` **no es un agente más que
la organización activa/conecta como Aux Contable** — es un **copiloto de la plataforma misma**.
Diferencias concretas con un agente de catálogo:

| | Agente de catálogo (p. ej. Aux Contable) | Copiloto de plataforma (`agent_builder`) |
|---|---|---|
| Visible en `/app/agentes` (picker/catálogo) | Sí | No — nunca aparece como algo que se "activa" |
| Requiere fila `agent_config` (`enabled`, schedule, business_rules) | Sí | No — siempre disponible para cualquier miembro con permiso, sin toggle de activación |
| `providerKey` / `app_connections` propios | Sí (uno) | No tiene conexión externa propia — solo lee metadata (qué provee la org) para asesorar |
| Cómo se accede | Se elige, se activa, luego se le chatea | Punto de entrada permanente del panel (p. ej. una acción fija tipo "Crear agente" / copiloto flotante) — no es algo que un usuario "elija entre varios" |
| Qué produce | Resultados de negocio (facturas, clasificaciones) | Filas `custom_agents` — es una herramienta *para construir* agentes, no un agente que resuelve tareas de negocio |

Internamente sí conviene reutilizar la infraestructura del loop (persistencia de steps/tool_calls,
`POST /api/v1/chat` o un endpoint de copiloto equivalente) porque ya resuelve exactamente lo que hace
falta — pero eso es un detalle de implementación, no lo hace "un agente del catálogo" de cara al
usuario. Se resuelve manteniéndolo **fuera** del `Map` de `AgentDefinition` que alimenta el picker de
catálogo: el panel nunca lo lista, y el copiloto no pasa por `agent_config`/`enabled`.

Tools internas del copiloto (no tocan `rest-client.ts`, no son tools de proveedor):

- `list_connected_providers` — lee `app_connections` de la org (qué ya está conectado).
- `list_provider_tools(provider_key)` — lee `getToolRegistry(provider_key)` y devuelve
  nombre + descripción de cada tool, para que el modelo decida qué ofrecer.
- `save_custom_agent(name, description, system_prompt, provider_key, enabled_tool_names, status)`
  — upsert en `custom_agents`, validado con zod, escribe `audit_log` (regla 7). Persistida antes de
  ejecutar igual que cualquier otra tool (regla no-negociable 4).

El system prompt del copiloto lo instruye a entrevistar al usuario (qué necesita automatizar, con
qué aplicación, qué debe y no debe poder hacer el agente resultante), proponer un `system_prompt`
candidato, y llamar `save_custom_agent` con `status='draft'` — el usuario activa el agente resultante
(`status='active'`) desde `/app/agentes`, donde ese agente custom sí aparece igual que uno de
catálogo una vez creado. El copiloto en sí nunca aparece ahí.

## 6. No-objetivos explícitos de este pivote (v1)

- ~~No se permite definir un conector/proveedor nuevo desde la UI~~ — **revertido en la segunda
  ronda de decisiones (2026-08-27), ver `docs/conectores-roles-interactividad.md` §1**: sí se
  permite, vía MCP o REST autoservicio, además de los `provider_key` curados en código como Alegra.
- **No** hay agentes multi-proveedor en v1 — un `custom_agents.provider_key` por agente, igual que
  `AgentDefinition.providerKey` hoy.
- **No** hay editor de texto libre para el `system_prompt` en v1 — se genera vía la entrevista del
  wizard. Reduce superficie de prompt injection / mal uso y mantiene la garantía de la regla 9
  (distinción soporte-audit y equivalentes se siguen verificando en código para Aux Contable; un
  agente custom no tiene ese tipo de distinción salvo que el wizard la modele explícitamente en
  tools, nunca solo en texto).
- **No** cambia el comportamiento de Aux Contable, WhatsApp/Telegram, reportes semanales ni
  `dian_sync` — se migran a este modelo sin tocar su lógica (ver §7).

## 7. Migración y compatibilidad (sin downtime)

1. Migración Drizzle aditiva: nueva tabla `custom_agents`; `agent_config` relaja su `unique` y quita
   el `CHECK` de `agent_type`. Ninguna fila existente se toca.
2. `AgentDefinition` de Aux Contable (`aux-contable/definition.ts`) no cambia una línea — sigue
   registrada igual, sigue siendo `agentType='aux_contable'`.
3. `resolveAgentDefinition` gana la rama `custom:` sin alterar la rama existente — agentes de
   catálogo siguen resolviendo exactamente igual.
4. Panel: `/app/configuracion-agente` (asume un agente único por org) se generaliza a
   `/app/agentes` (lista de agentes activos de la org, catálogo + custom) con
   `/app/agentes/[agentType]/configuracion` por instancia; `/app/chat` gana selector de agente
   cuando la org tiene más de uno activo. El copiloto de plataforma es un punto de entrada aparte,
   siempre visible (no una fila de `/app/agentes`) — p. ej. una acción fija "Crear agente" que abre
   su propia conversación. Esto es trabajo de UI nuevo, no rompe rutas existentes hasta que se
   reemplacen explícitamente.
5. Ninguna migración de datos de organizaciones existentes: siguen teniendo su única fila
   `agent_config` con `agent_type='aux_contable'`, ahora simplemente ya no son la única fila posible.

## 8. Impacto en `CLAUDE.md` / reglas

- Regla 9 ("la distinción soporte-audit se verifica en código") sigue aplicando literal a Aux
  Contable; se aclara que es una propiedad de *ese* agente de catálogo, no una garantía genérica de
  la plataforma para agentes custom (que no tienen ese caso).
- `.claude/rules/agent-loop.md` no cambia — el invariante de persistir antes de ejecutar aplica
  igual a tools internas del `agent_builder` (`save_custom_agent`) que a tools de proveedor.
- `.claude/rules/alegra-tools.md` se generaliza mentalmente a "reglas de tools de proveedor" — ya
  está escrito de forma provider-agnóstica salvo el nombre del archivo; no urge renombrarlo.
- Nueva convención a documentar cuando se construya: un directorio por agente de catálogo bajo
  `src/server/agent/<agent_type>/`, igual que hoy `aux-contable/`. El copiloto de plataforma
  (`agent_builder`) vive aparte — p. ej. `src/server/copilot/` — precisamente para que no se
  confunda con un módulo más registrado en el `Map` de catálogo que alimenta el picker de
  `/app/agentes`.

## 9. Próximo paso

Este documento es el diseño; construirlo es trabajo aparte (fuera del alcance de esta sesión, que
fue solo diseño). Cuando se decida construir: nueva migración Drizzle para `custom_agents` +
relajar `agent_config` (skill `add-migration`), luego `agent_builder` como agente de catálogo nuevo
(mismo patrón que `aux-contable/`, sin skill dedicado hoy — sería candidato a
`.claude/skills/add-agent-type/SKILL.md` si se repite).

**Continúa en `docs/conectores-roles-interactividad.md`** (2026-08-27, segunda ronda): conectores
autoservicio (MCP + REST, ya no solo código curado — reemplaza el primer punto de §6 de este
documento), roles `owner`/`operator`/`viewer` + `platform_admin`, marketplace público de agentes
custom, streaming en tiempo real e interactividad del panel.
