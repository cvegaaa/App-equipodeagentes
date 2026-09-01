# Decisión de integración: conector genérico + piloto Alegra

Spike previo a `E1-T6` (cliente REST genérico + registro de tools) y `E1-T9` (disparador de
sincronización). No se escribe código de integración en este paso — solo se fija el contrato que
`E1-T6` y `E1-T9` deben implementar.

## Alcance de la integración

Este proyecto se integra **únicamente con Alegra**, el software contable del cliente, y **únicamente
mediante su API REST autenticada por token**. GEIFEM Agentes no llama a la DIAN, no recibe eventos
de la DIAN y no implementa ningún protocolo de facturación electrónica. La sincronización de
documentos desde la DIAN hacia Alegra ocurre por completo dentro del entorno de Alegra, con sus
propios módulos — es responsabilidad de Alegra, no de este proyecto. Lo único que este proyecto hace
es **consultar periódicamente la API REST de Alegra** para detectar documentos (gastos, facturas de
compra) que Alegra ya sincronizó y clasificar/registrar sobre ellos, y **crear facturas de venta**
cuando el agente lo determina.

## Contrato del conector genérico

`src/lib/connectors/rest-client.ts` es el único módulo que hace `fetch` hacia la API REST de un
proveedor externo (`app_connections.base_url`). Es genérico — Alegra es el primer `provider_key`
piloto, no un caso especial.

**`auth_type` soportados** (columna `app_connections.auth_type`, check constraint):

| auth_type | Cómo inyecta el token | Uso en el piloto Alegra |
|---|---|---|
| `bearer_token` | Header `Authorization: Bearer <token>` | no aplica a Alegra |
| `api_key_header` | Header configurable por `auth_header_name` (p. ej. `X-Api-Key: <token>`) | no aplica a Alegra |
| `basic` | Header `Authorization: Basic base64(email:token)` | **el que usa Alegra** — Alegra autentica con el correo de la cuenta y el token de API generados en Configuración → API - Integraciones con otros sistemas, concatenados como `email:token` y codificados en base64 |

Para el piloto Alegra, `app_connections.auth_type = 'basic'` y `auth_header_name` queda nulo (solo se
usa cuando `auth_type = 'api_key_header'`).

**Forma del error en timeout.** `rest-client.ts` nunca lanza el error crudo de `fetch`/`AbortController`
hacia el llamador. Todo error de red o timeout se normaliza a un resultado tipado:

```ts
{ ok: false, error: { code: "timeout", message: string } }
```

Un error HTTP (4xx/5xx de Alegra) se normaliza aparte como
`{ ok: false, error: { code: "http_error", message: string, details: { status: number, body: unknown } } }`
— mismo campo `code` que usa el resto del proyecto (`model_call_failed`, `validation_error`, etc., ver
`CLAUDE.md` §5). Ningún caller de `rest-client.ts` recibe una excepción sin capturar ni el token en
texto plano dentro del objeto de error (regla no negociable #1 del proyecto). Implementado en
`src/lib/connectors/rest-client.ts` (`E1-T6`).

## Webhooks DIAN-sync

**No hay webhook de DIAN-sync en este proyecto — no aplica.** Este proyecto no se integra con la
DIAN bajo ninguna forma; no existe un endpoint de la DIAN consultado ni un receptor de eventos de la
DIAN. La sincronización DIAN → Alegra es interna a Alegra y ocurre en sus propios módulos, fuera del
alcance de GEIFEM Agentes.

Nota de investigación: Alegra sí expone un programa de webhooks, pero es para su rol de **proveedor
tecnológico de facturación electrónica** (eventos como `governmentStatusChanged`,
`emissionFinished`, documentados en `e-provider-docs.alegra.com`) — un producto distinto al que este
proyecto consume. El piloto se conecta a Alegra como cliente normal de su API REST con token de
cuenta (`auth_type = 'basic'`), no como proveedor electrónico, por lo que ese programa de webhooks no
es accesible ni relevante aquí. En consecuencia, el paso `E1-T9` no implementa `POST
/api/webhooks/alegra`.

## Creación de facturas de venta

Endpoint verificado en `developer.alegra.com/reference/post_invoices`:

```
POST https://api.alegra.com/api/v1/invoices
```

Autenticado con el mismo header `Authorization: Basic base64(email:token)` de la conexión. Las tools
de `E1-T6` (`src/lib/alegra/tools.ts`) construyen el body de la factura de venta y llaman a este
endpoint a través de `rest-client.ts` — nunca directo con `fetch`.

Para detectar documentos ya sincronizados por Alegra desde la DIAN (gastos y facturas de compra que
el agente debe clasificar), las tools consultan:

```
GET https://api.alegra.com/api/v1/bills
```

## Mecanismo de sincronización elegido

Sin webhook disponible ni aplicable (ver sección anterior), el disparador de `E1-T9` consulta la API
de Alegra por sondeo periódico (cron `GET /api/cron/dian-sync`, autorizado con `CRON_SECRET`), usando
`dian_sync_cursor.last_external_document_id` para no reprocesar documentos ya vistos en `GET /bills`.

Mecanismo elegido: polling
