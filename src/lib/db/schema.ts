import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    platformRole: text("platform_role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 'platform_admin' (superadmin) reemplaza a 'geifem_admin' — contracción del paso expand
    // anterior (docs/plataforma-multiagente-pivot.md §1). Las filas existentes se migran en la
    // misma migración que quita el valor viejo del CHECK (docs/roles-y-workspaces-2026-08.md).
    check(
      "platform_role_check",
      sql`${t.platformRole} is null or ${t.platformRole} = 'platform_admin'`,
    ),
  ],
);

// session, account y verification son las tablas propias de better-auth (self-hosted) — mismo
// Postgres, migradas con drizzle-kit como el resto del esquema (regla: nunca SQL de migración a
// mano). `user` de arriba es el modelo de identidad que better-auth reutiliza vía drizzleAdapter.
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  // Namespace estable de identidad de la cuenta (better-auth 1.7+) — para el proveedor de
  // credencial (email+contraseña) better-auth la fija sola, nunca la escribe este proyecto.
  issuer: text("issuer").notNull(),
  password: text("password"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const organization = pgTable(
  "organization",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // Número de WhatsApp (formato E.164 sin '+', p. ej. "573001234567") desde el que el cliente le
    // escribe al agente — único, es la clave de mapeo del webhook entrante hacia la organización.
    whatsappNumber: text("whatsapp_number").unique(),
    // chat.id numérico de Telegram (como string) del cliente — único, misma función de mapeo que
    // whatsappNumber pero para el webhook entrante de Telegram.
    telegramChatId: text("telegram_chat_id").unique(),
    // El superadmin puede bloquear una organización (docs/roles-y-workspaces-2026-08.md) — una
    // org bloqueada no puede enviar mensajes de chat/copiloto ni activar agentes, aunque sus
    // filas siguen intactas (nunca se borra nada al bloquear).
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("organization_status_check", sql`${t.status} in ('active','blocked')`)],
);

export const membership = pgTable(
  "membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    invitedBy: text("invited_by").references(() => user.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("membership_user_org_unique").on(t.userId, t.orgId),
    index("membership_org_id_idx").on(t.orgId),
    index("membership_user_id_idx").on(t.userId),
    // Dos niveles (docs/roles-y-workspaces-2026-08.md): 'owner' ("Administrador" en la UI) — crea
    // la organización o fue promovido, gestiona miembros/conectores/configuración de agentes,
    // activa agentes. 'operator' ("Usuario" en la UI) — usa agentes ya activos (chat), no
    // administra nada de la organización. Reemplaza el esquema de 3 niveles anterior — 'viewer'
    // se quita del CHECK (ninguna fila lo usaba todavía).
    check("membership_role_check", sql`${t.role} in ('owner','operator')`),
  ],
);

// provider_key identifica el proveedor conectado (p. ej. 'alegra') cuando kind='platform_rest' —
// genérico, nunca una tabla especial por proveedor. Ver docs/connector-integration-decision.md.
//
// Generalizado a conector autoservicio (docs/conectores-roles-interactividad.md §1): `kind`
// distingue un proveedor curado en código (`platform_rest`, sin cambios de comportamiento — Alegra
// sigue siendo el piloto) de un conector que la propia organización define (`custom_rest`, sus
// tools viven en `connector_operations`) o conecta vía protocolo (`mcp`, sus tools se descubren en
// caliente contra `base_url`). `provider_key` solo aplica a `platform_rest` — por eso pasa a ser
// nullable; `base_url` se reutiliza como server_url para `mcp`. Nunca se guarda un `base_url`/
// `server_url` sin validar contra rangos privados/loopback antes de ejecutar (riesgo SSRF, ver
// docs/conectores-roles-interactividad.md §1.4) — pendiente de implementar junto con el ejecutor.
export const appConnections = pgTable(
  "app_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("platform_rest"),
    // Nombre que el usuario le da a la conexión — solo requerido para custom_rest/mcp; un
    // platform_rest existente sin nombre sigue siendo válido (se muestra el provider_key).
    name: text("name"),
    providerKey: text("provider_key"),
    baseUrl: text("base_url").notNull(),
    // Solo aplica a kind='mcp' — los dos transportes remotos del protocolo (nunca stdio, esto
    // corre en un servidor multi-tenant).
    transport: text("transport"),
    authType: text("auth_type").notNull(),
    authHeaderName: text("auth_header_name"),
    encryptedToken: text("encrypted_token").notNull(),
    status: text("status").notNull().default("active"),
    enteredByUserId: text("entered_by_user_id")
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULL en provider_key no colisiona entre sí (Postgres trata NULLs como distintos en un
    // unique) — varios conectores custom_rest/mcp por org conviven sin problema con esta constraint.
    unique("app_connections_org_provider_unique").on(t.orgId, t.providerKey),
    check("app_connections_kind_check", sql`${t.kind} in ('platform_rest','custom_rest','mcp')`),
    check(
      "app_connections_transport_check",
      sql`${t.transport} is null or ${t.transport} in ('http','sse')`,
    ),
    check(
      "app_connections_status_check",
      sql`${t.status} in ('pending_verification','active','error')`,
    ),
    check(
      "app_connections_auth_type_check",
      sql`${t.authType} in ('bearer_token','api_key_header','basic')`,
    ),
  ],
);

// Tools como datos — solo para conectores kind='custom_rest' (docs/conectores-roles-interactividad.md
// §1.2). Un conector 'mcp' no tiene filas aquí: sus tools se descubren en caliente contra el propio
// servidor (`tools/list`), esta tabla nunca es su fuente de verdad. Un conector 'platform_rest'
// tampoco: sus tools son código en providers/<provider_key>/.
export const connectorOperations = pgTable(
  "connector_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => appConnections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    inputSchema: jsonb("input_schema").notNull().default({}),
    idempotent: boolean("idempotent").notNull().default(false),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("connector_operations_connection_id_idx").on(t.connectionId),
    check(
      "connector_operations_method_check",
      sql`${t.method} in ('GET','POST','PUT','PATCH','DELETE')`,
    ),
    check("connector_operations_source_check", sql`${t.source} in ('manual','imported')`),
  ],
);

// Una fila por agente activo por organización (antes: una fila por organización, período —
// docs/plataforma-multiagente-pivot.md §3). `agent_type` ya no tiene un CHECK de valores fijos:
// para un agente de catálogo es el string registrado en código (p. ej. 'aux_contable', sin cambios);
// para un agente custom es `custom:${customAgents.id}`. La validación de que `agent_type` resuelve
// a algo real pasa a `resolveAgentDefinition` en `src/server/agent/loop.ts`, igual que ya pasa hoy
// con `provider_key` (nunca tuvo CHECK, siempre se validó en código).
export const agentConfig = pgTable(
  "agent_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentType: text("agent_type").notNull().default("aux_contable"),
    enabled: boolean("enabled").notNull().default(false),
    businessRules: jsonb("business_rules").notNull().default({}),
    // Default: una vez al día (medianoche UTC). Editable por organización — nunca hardcodeado en
    // el poller (E2-T3 lee esta columna, no una constante).
    syncSchedule: text("sync_schedule").notNull().default("0 0 * * *"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("agent_config_org_agent_type_unique").on(t.orgId, t.agentType)],
);

// La "receta" de un agente creado por una organización vía el copiloto de plataforma (no un agente
// de catálogo — docs/plataforma-multiagente-pivot.md §3 y §5). 100% datos: ni system_prompt ni
// selección de tools requieren código nuevo. `connector_id` queda NULL hasta que la organización
// conecta (o, si viene de clonar del marketplace, vuelve a conectar) su propia instancia del
// conector — nunca se comparte una conexión/credencial entre organizaciones
// (docs/conectores-roles-interactividad.md §3).
export const customAgents = pgTable(
  "custom_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    // Ensamblado por el copiloto a partir de la entrevista — sin editor de texto libre en v1
    // (docs/plataforma-multiagente-pivot.md §6).
    systemPrompt: text("system_prompt").notNull(),
    connectorId: uuid("connector_id").references(() => appConnections.id),
    enabledToolNames: jsonb("enabled_tool_names").notNull().default([]),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("private"),
    moderationStatus: text("moderation_status").notNull().default("none"),
    moderatedByUserId: text("moderated_by_user_id").references(() => user.id),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("custom_agents_org_id_idx").on(t.orgId),
    check("custom_agents_status_check", sql`${t.status} in ('draft','active','archived')`),
    check("custom_agents_visibility_check", sql`${t.visibility} in ('private','public')`),
    check(
      "custom_agents_moderation_status_check",
      sql`${t.moderationStatus} in ('none','pending_review','approved','rejected')`,
    ),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentType: text("agent_type").notNull().default("aux_contable"),
    triggerType: text("trigger_type").notNull(),
    status: text("status").notNull().default("queued"),
    input: jsonb("input").notNull().default({}),
    result: jsonb("result"),
    // Header `Idempotency-Key` de POST /api/v1/chat (E2-T4) — nulo para runs de otros triggers.
    // Repetir la misma clave para la misma organización devuelve el runId ya existente.
    idempotencyKey: text("idempotency_key"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("runs_org_status_idx").on(t.orgId, t.status),
    index("runs_org_created_idx").on(t.orgId, t.createdAt),
    index("runs_org_idempotency_idx").on(t.orgId, t.idempotencyKey),
    // 'copilot_request' es el copiloto de plataforma (docs/plataforma-multiagente-pivot.md §5) —
    // nunca un agente del catálogo, siempre agentType='platform_copilot'.
    check(
      "runs_trigger_check",
      sql`${t.triggerType} in ('dian_sync','chat_request','invoice_request','copilot_request')`,
    ),
    check(
      "runs_status_check",
      sql`${t.status} in ('queued','running','succeeded','failed','cancelled','budget_exceeded')`,
    ),
  ],
);

export const steps = pgTable(
  "steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("steps_run_ordinal_unique").on(t.runId, t.ordinal),
    check("steps_kind_check", sql`${t.kind} in ('model','tool')`),
  ],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stepId: uuid("step_id")
      .notNull()
      .references(() => steps.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    args: jsonb("args").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    result: jsonb("result"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tool_calls_step_id_idx").on(t.stepId)],
);

export const traces = pgTable(
  "traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => steps.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("traces_run_id_idx").on(t.runId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .unique()
      .references(() => runs.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_status_run_after_idx").on(t.status, t.runAfter),
    check("jobs_status_check", sql`${t.status} in ('queued','claimed','done','failed')`),
  ],
);

export const weeklyReport = pgTable(
  "weekly_report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    audience: text("audience").notNull(),
    content: text("content").notNull(),
    generatedFrom: jsonb("generated_from").notNull(),
    sentEmailAt: timestamp("sent_email_at", { withTimezone: true }),
    sentWhatsappAt: timestamp("sent_whatsapp_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("weekly_report_org_period_audience_unique").on(t.orgId, t.periodStart, t.audience),
    check("weekly_report_audience_check", sql`${t.audience} in ('client','operator')`),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    period: date("period").notNull(),
    runCount: integer("run_count").notNull().default(0),
    tokensTotal: integer("tokens_total").notNull().default(0),
    costTotalCents: integer("cost_total_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("usage_events_org_period_unique").on(t.orgId, t.period),
    index("usage_events_org_id_idx").on(t.orgId),
  ],
);

// Append-only: ningún módulo hace UPDATE/DELETE sobre esta tabla — único escritor es
// src/server/audit.ts.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id").references(() => user.id),
  orgId: uuid("org_id").references(() => organization.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dianSyncCursor = pgTable("dian_sync_cursor", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastExternalDocumentId: text("last_external_document_id"),
});
