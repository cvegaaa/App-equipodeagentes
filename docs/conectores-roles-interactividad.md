# Conectores autoservicio (MCP + REST), roles multiempresa, marketplace, interactividad

Extiende `docs/plataforma-multiagente-pivot.md` con las decisiones del dueño del proyecto,
2026-08-27 (segunda ronda). Léase después de ese documento — no repite su contexto.

## 1. Conectores: de "código por proveedor" a autoservicio (REST + MCP)

Decisión: **autoservicio total**. Un usuario puede conectar cualquier servidor MCP o cualquier API
REST propia, sin que GEIFEM tenga que escribir un `providers/<key>/` nuevo. Esto es más flexible que
el no-objetivo que fijaba el primer documento (§6, primer punto) — **queda reemplazado**: sí se
permite definir un conector nuevo desde la UI.

### 1.1 `connectors` reemplaza conceptualmente a `app_connections`

Migración aditiva: se agregan columnas a `app_connections` (o se crea `connectors` y se migra en una
sola operación — decisión de implementación, no de diseño). Forma objetivo:

| Columna | Nota |
|---|---|
| `id`, `org_id` | igual que hoy |
| `kind` | `check in ('platform_rest', 'custom_rest', 'mcp')` |
| `name` | nombre que el usuario le da a la conexión (antes implícito por `provider_key`) |
| `provider_key` | solo para `kind='platform_rest'` — el conector de código existente (Alegra sigue siendo uno de estos, sin cambios) |
| `base_url` / `server_url` | REST o MCP respectivamente |
| `transport` | solo `mcp`: `check in ('http','sse')` — los dos transportes remotos del protocolo MCP; **no stdio**, esto corre en un servidor multi-tenant, no en un proceso local del usuario |
| `auth_type`, `auth_header_name`, `encrypted_token` | igual mecanismo que hoy (`src/lib/encryption.ts`), aplica a los tres `kind` |
| `status` | `check in ('pending_verification','active','error')` — nuevo. Un conector `custom_rest`/`mcp` nace `pending_verification` hasta pasar el paso de descubrimiento/prueba (ver 1.3) |
| `created_by_user_id`, `created_at`, `updated_at` | igual que hoy |

`platform_rest` es exactamente el `app_connections` de hoy — Aux Contable sobre Alegra no cambia una
sola línea de código ni de fila.

### 1.2 `connector_operations` — las tools como datos (solo `custom_rest`)

Un conector `custom_rest` no tiene un `providers/<key>/tools.ts` escrito por GEIFEM — el usuario (o el
copiloto, asistiéndolo) define sus operaciones:

| Columna | Nota |
|---|---|
| `id`, `connector_id` | |
| `name` | nombre de tool que ve el modelo, p. ej. `crear_recordatorio` |
| `description` | para que el modelo decida cuándo usarla |
| `method`, `path` | `GET/POST/PUT/PATCH/DELETE` + ruta relativa a `base_url` |
| `input_schema` | JSON Schema — de dónde sale el `inputSchema` que hoy cada tool exporta a mano |
| `idempotent` | boolean, el usuario lo marca explícitamente (nunca se asume) |
| `source` | `check in ('manual','imported')` — `imported` cuando viene de un OpenAPI pegado/subido, no cambia el resto del flujo |
| `created_at` | |

Un conector `mcp` **no** necesita esta tabla — sus tools se descubren en caliente hablando el
protocolo (`tools/list`) contra `server_url`; se cachea el resultado solo como UX (para el picker del
copiloto/constructor visual), nunca como fuente de verdad — la fuente de verdad de un tool MCP es el
propio servidor MCP en el momento de ejecutar.

### 1.3 Ejecución — dos módulos nuevos, mismo contrato que `rest-client.ts`

- `src/lib/connectors/mcp-client.ts` — único módulo que habla el protocolo MCP (JSON-RPC 2.0 sobre
  HTTP o SSE) hacia un `server_url` de un `connector` con `kind='mcp'`. Expone `listTools()` y
  `callTool(name, args)`, devuelve el mismo `RestResult<T>` tipado que ya existe — nunca lanza una
  excepción cruda, nunca loguea el token/credencial de autenticación del servidor MCP.
- `src/lib/connectors/custom-rest-executor.ts` — construye la llamada HTTP a partir de una fila
  `connector_operations` (`method` + `path` + `input_schema`) y la ejecuta a través de
  `rest-client.ts` (no lo reemplaza, lo usa — `rest-client.ts` sigue siendo el único punto que hace
  `fetch`, regla no-negociable 3 sigue vigente en espíritu: sigue siendo el único punto que hace
  `fetch` hacia un proveedor externo, ahora con dos formas de llegar ahí).

`connectors/registry.ts` (`getToolRegistry`) se generaliza a una función que, dado un `connector_id`,
devuelve el mapa de `ToolDefinition` sin importar el `kind`:
- `platform_rest` → registro de código existente (sin cambios).
- `custom_rest` → construido en memoria desde `connector_operations`, validando cada llamada contra
  `input_schema` antes de ejecutar (regla de `.claude/rules/alegra-tools.md`: todo argumento se
  valida — para JSON Schema en vez de zod nativo, se necesita un validador de JSON Schema en
  runtime; es una dependencia nueva justificada — ver §5).
- `mcp` → `listTools()` en el momento de armar el prompt, filtrado por lo que el agente tiene
  habilitado.

`custom_agents.provider_key` (del primer documento) se reemplaza por `custom_agents.connector_id` —
un agente custom se ata a una conexión concreta de la organización, no a un `provider_key` global.
Todo lo demás del loop (`loop.ts`) no cambia: sigue resolviendo un `AgentDefinition`, sigue
persistiendo `tool_calls` antes de ejecutar, sigue teniendo presupuesto de steps — el `kind` del
conector es invisible para el loop, vive solo en cómo se construye el `AgentDefinition.tools`.

### 1.4 Riesgo nuevo: SSRF — no-negociable adicional

Autoservicio total significa que una organización puede pegar **cualquier URL** como `base_url` o
`server_url`. Sin control, el servidor de GEIFEM haría `fetch`/llamadas MCP hacia esa URL a pedido
del usuario — vector clásico de SSRF (Server-Side Request Forgery) contra la red interna del VPS
donde corre la plataforma (`localhost`, IPs privadas, el propio Postgres, metadata de nube si migra a
uno). **No-objetivo del primer documento §6 punto 3 ("no editor de prompt libre") se mantiene, pero
se agrega uno nuevo, obligatorio antes de construir esto:**

- Todo `base_url`/`server_url` de un conector `custom_rest`/`mcp` se valida server-side (no solo en
  el navegador) contra un bloqueo de rangos privados/loopback/link-local antes de guardarse y en
  cada resolución de DNS al momento de ejecutar (defensa contra DNS rebinding) — esto es tan
  no-negociable como los seis puntos existentes de `CLAUDE.md`, se agrega ahí cuando esto se
  construya.

## 2. Roles

`membership.role` gana un tercer valor: `check in ('owner','operator','viewer')`.

| Rol | Puede |
|---|---|
| `owner` | Todo lo de `operator`, más: gestionar miembros (invitar/quitar), crear/eliminar conectores, activar/desactivar cualquier agente de la organización, publicar un agente al marketplace público |
| `operator` | Chatear con agentes activos, ajustar `business_rules`/config de un agente ya creado, usar el copiloto para crear agentes en `draft` (no activarlos) — igual que el rol `operator` de hoy, sin cambios de comportamiento |
| `viewer` | Solo lectura — igual que hoy |

Migración: toda `membership` existente tiene `role='operator'` — no hay dato que reclasificar
automáticamente a `owner` sin criterio de negocio (¿el que creó la organización? ¿el primer
miembro?); se deja como decisión explícita de la migración cuando se construya, no asumida aquí.

`user.platformRole` se renombra de `'geifem_admin'` a `'platform_admin'` (consistente con
`docs/plataforma-multiagente-pivot.md` §1 — GEIFEM ya no es el nombre del negocio central). Migración
aditiva: agregar `'platform_admin'` al `CHECK`, migrar filas `platformRole='geifem_admin'` →
`'platform_admin'`, quitar el valor viejo del `CHECK`. Nueva capacidad de `platform_admin`: visibilidad
de todas las organizaciones (ya la tenía `geifem_admin` vía `requirePlatformAdmin`), más moderar el
marketplace público (§3).

## 3. Marketplace público de agentes

`custom_agents` gana:

| Columna | Nota |
|---|---|
| `visibility` | `check in ('private','public')`, default `'private'` |
| `moderation_status` | `check in ('none','pending_review','approved','rejected')`, default `'none'` — pasa a `'pending_review'` cuando el `owner` pide publicar |
| `moderated_by_user_id`, `moderated_at` | quién de `platform_admin` decidió |

**Nunca se comparte el conector ni la credencial al publicar o clonar** — un agente publicado
expone `name`, `description`, `system_prompt` y `enabled_tool_names` (por nombre, no por
`connector_id`). Clonar (`clone_agent`, acción del panel — no del copiloto, es una operación de
copiar datos, no una entrevista) crea una fila `custom_agents` nueva para la organización que clona,
con `status='draft'`, `connector_id = NULL` — la organización que clona **debe conectar su propia**
instancia del mismo `kind` de conector antes de poder activarlo. Esto es la misma garantía que ya
existe para `app_connections` hoy (cada organización trae su propio token) extendida al marketplace.

## 4. Interactividad

### 4.1 Streaming en tiempo real (prioridad 1)

Hoy el chat depende de `POST /api/v1/chat` (`202`) + poll a `GET /api/v1/runs/:id`. Se agrega
`GET /api/v1/runs/:id/stream` (Server-Sent Events, no WebSockets — un solo sentido servidor→cliente
es suficiente para esto y SSE no necesita infraestructura nueva). v1 del stream: el route handler
hace poll interno a `steps`/`runs` cada ~500ms y emite un evento SSE por cada fila nueva o cambio de
`runs.status` — sin mensajería nueva (Postgres `LISTEN`/`NOTIFY` sería más eficiente pero es una
dependencia operativa nueva; se deja como mejora futura, no bloquea v1). El componente de chat del
panel pasa a ser un client component que consume `EventSource` y va agregando steps a medida que
llegan, en vez de esperar el resultado final.

### 4.2 Constructor visual del agente (prioridad 2)

Un editor en el panel (dentro de `/app/agentes/[agentType]/configuracion` para un agente ya creado,
o como paso posterior a la entrevista del copiloto) donde las tools disponibles del conector elegido
se listan como chips arrastrables hacia una zona "habilitadas" — escribe directo a
`custom_agents.enabled_tool_names` vía server action, **el mismo dato que escribe la tool
`save_custom_agent` del copiloto** (§5 del primer documento). Son dos puertas de entrada al mismo
estado, no dos sistemas paralelos — evita que el constructor visual y el copiloto diverjan en lo que
puede expresar cada uno.

## 5. Dependencia nueva a justificar cuando se construya

Validar `input_schema` (JSON Schema) de una `connector_operations` en runtime necesita un validador
de JSON Schema (p. ej. `ajv`) — hoy el proyecto valida todo con `zod` porque los esquemas están
escritos a mano en código; un conector autoservicio recibe el esquema como dato, no como código
TypeScript, y `zod` no consume JSON Schema directamente. Justificación para el commit que la
introduzca (regla 10): validar argumentos de tool definidos por el usuario antes de ejecutar es
no-negociable (regla 8 del proyecto aplica a cualquier tool, no solo a las de código), y no hay
alternativa en la librería estándar ni en las dependencias ya presentes.

## 6. Qué no se decidió todavía (dejar explícito, no implícito)

- OAuth para servidores MCP que lo exijan (hoy el modelo de auth es token/header/basic, igual que
  REST) — v1 asume que el servidor MCP acepta un token estático, igual que un `provider_key` REST.
  Si un MCP público relevante exige OAuth completo, es una extensión futura, no v1.
- Qué pasa con un conector `mcp`/`custom_rest` cuyo servidor cambia sus tools entre que se creó el
  agente y que corre un run (el MCP no tiene "versión" fija como el código de `providers/alegra/`) —
  v1 revalida `enabled_tool_names` contra el `listTools()` en vivo al armar el prompt y descarta
  silenciosamente los que ya no existen, dejando traza en `traces`/logs — no falla el run entero por
  esto, pero es una superficie a vigilar.
- Cuotas/costos por organización y notificaciones (señaladas como huecos al principio de esta ronda)
  quedan fuera de este documento — son ejes independientes, no bloquean conectores/roles/marketplace/
  streaming.
