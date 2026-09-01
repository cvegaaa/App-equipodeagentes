# Roles, espacios de trabajo individuales y superadmin

Decisión del dueño del proyecto, 2026-08-28. Reemplaza el esquema de roles de 3 niveles
(`owner`/`operator`/`viewer`) propuesto en `docs/conectores-roles-interactividad.md` §2 — ese
documento anticipaba la necesidad, este fija el esquema real que se construyó.

## 1. El esquema

| Nivel | Alcance | Puede |
|---|---|---|
| **Superadmin** (`user.platform_role = 'platform_admin'`) | Toda la plataforma | Crear/bloquear/desbloquear organizaciones, promover o quitar otros superadmins, ver observabilidad cross-tenant. Nunca puede quedar en cero — la última cuenta con este rol no se puede degradar (`wouldRemoveLastSuperadmin`, `src/app/app/plataforma/usuarios/actions.ts`). |
| **Administrador** (`membership.role = 'owner'` — el valor de DB no cambió de nombre, la UI lo llama "Administrador") | Una organización | Todo lo de Usuario, más: invitar/quitar miembros, crear y editar conectores (incluye credenciales — Conexiones y el copiloto), configurar agentes (tono, descripción, umbrales, canales), activar agentes custom. |
| **Usuario** (`membership.role = 'operator'` — mismo valor de DB que antes, ahora es el nivel más bajo) | Una organización | Chatear con cualquier agente ya activo (catálogo o custom). No administra nada de la organización. |

`viewer` se quitó del `CHECK` de `membership.role` — ninguna fila lo usaba todavía en producción.
No hay más un rol de "solo lectura sin poder actuar": cualquier miembro aceptado ya puede chatear,
la distinción es sobre quién *administra*, no sobre quién *usa*.

**Decisión de implementación que vale la pena hacer explícita:** los valores de columna en la base
de datos siguen siendo `'owner'`/`'operator'` en inglés — no se renombraron a `'admin'`/`'usuario'`.
Mismo patrón que el resto del proyecto (`agent_type='aux_contable'`, `trigger_type='chat_request'`):
identificadores estables en código/DB, etiquetas en español en la UI. Evita una migración de datos
más arriesgada sin ganar nada funcional.

### Por qué el copiloto quedó como acción de administrador

El copiloto puede guardar credenciales de terceros (`create_custom_connector`) y definir qué puede
hacer un agente (`add_connector_operation`, `save_custom_agent` con `status='active'`). Se trató el
*acceso al copiloto en sí* como una capacidad de administrador en v1 — no hay todavía permisos por
tool dentro de una conversación, así que la única palanca disponible es "quién puede hablarle al
copiloto en absoluto". Un Usuario puede seguir usando cualquier agente que un Administrador ya
activó.

## 2. Espacio de trabajo individual — no es una tabla nueva

"Uso individual, sin organización, pero con espacio de trabajo" se resolvió como una
**organización normal, auto-creada, de un solo miembro, sin flujo de invitación** — no un concepto
ni una tabla separados. Reutiliza `organization`/`membership` tal cual:

- `src/app/bienvenida/` — página fuera del árbol de `/app/app` (evita el loop de redirección: si
  estuviera dentro heredaría el layout que redirige ahí mismo cuando no hay membresías).
- `AppLayout` (`src/app/app/layout.tsx`) redirige a `/bienvenida` cuando
  `memberships.length === 0 && !isPlatformAdmin` — un superadmin sin organización propia no se
  fuerza a crear una, ya tiene acceso plataforma-wide.
- `createPersonalWorkspaceAction` crea la organización y la membresía `role='owner'` en el mismo
  paso — quien crea su espacio individual es su propio administrador, nadie más lo gestiona a menos
  que él invite a alguien.

Consecuencia deliberada: un "espacio de trabajo individual" puede convertirse en una organización
multi-usuario normal en cualquier momento, simplemente invitando gente desde Miembros — no hay una
migración ni un cambio de tipo, porque nunca fueron cosas distintas.

## 3. Bloqueo de organizaciones (superadmin)

`organization.status` (`'active'`/`'blocked'`, default `'active'`) — bloquear **nunca borra ni
modifica ninguna otra fila**, solo corta la puerta de entrada. Aplicado en `assertOrgActive`
(`src/server/org-status.ts`), consultado en:

- `POST /api/v1/chat` y `POST /api/v1/copilot` — rechazan encolar un run nuevo con `403 org_blocked`.
- `activateCustomAgentAction` — no se puede activar un agente en una org bloqueada.
- `AppLayout` muestra un aviso permanente cuando la organización activa está bloqueada.

**Deliberadamente fuera de alcance de esta pasada:** el bloqueo no interrumpe un run ya en curso ni
oculta páginas de solo lectura (reportes, observabilidad de la propia org siguen visibles) — solo
impide *empezar* trabajo nuevo. Ampliar el bloqueo a más superficies es una decisión a pedido, no
asumida.

## 4. Migración de `geifem_admin` → `platform_admin`

El primer pivote (`docs/plataforma-multiagente-pivot.md`) ya había hecho el paso *expand* (aceptar
ambos valores). Esta pasada hizo el *contract*: migración `0009_lovely_the_liberteens.sql` —
`UPDATE user SET platform_role='platform_admin' WHERE platform_role='geifem_admin'` antes de
reinstalar el `CHECK` con un solo valor permitido. Sin ventana de inconsistencia: es una sola
migración, no dos pasos separados en el tiempo (justificado porque no hay tráfico de producción
real todavía — un sistema con usuarios activos necesitaría separar migrate y contract en
migraciones distintas con una pausa entre medio).

## 5. Qué quedó fuera, explícitamente

- **Permisos por tool** dentro de una conversación (p. ej. que un Usuario pueda chatear pero nunca
  disparar una tool que escribe) — no existe, la única gate es a nivel de "quién puede enviar un
  mensaje a este agente/copiloto".
- **Invitar a alguien que nunca inició sesión** — `inviteMemberAction` sigue exigiendo que la
  persona ya tenga cuenta (sin cambios en esta pasada).
- **Auditoría visible en el panel** de las acciones de superadmin (bloqueos, promociones) — se
  escriben en `audit_log` (regla no-negociable 7) pero no hay pantalla para leerlas todavía, más
  allá de consultarlas directo en la base de datos.
