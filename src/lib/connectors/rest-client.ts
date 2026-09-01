// Único módulo que hace `fetch` hacia la API REST de un proveedor externo conectado
// (`app_connections`) — genérico, nunca asume un proveedor concreto. Alegra es el piloto, sobre
// esta misma base; un proveedor nuevo nunca implica tocar este archivo.

export type RestAuthType = "bearer_token" | "api_key_header" | "basic";

export type RestConnection = {
  baseUrl: string;
  authType: RestAuthType;
  /** Nombre del header cuando `authType === "api_key_header"` (p. ej. "X-Api-Key"). */
  authHeaderName?: string | null;
  /** Token ya descifrado — nunca loguear ni incluir en un error. */
  token: string;
};

export type RestError =
  | { code: "timeout"; message: string }
  | { code: "http_error"; message: string; details: { status: number; body: unknown } };

export type RestResult<T> = { ok: true; data: T } | { ok: false; error: RestError };

type RequestOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** @default 10_000 */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function applyAuth(headers: Record<string, string>, connection: RestConnection): void {
  switch (connection.authType) {
    case "bearer_token":
      headers.Authorization = `Bearer ${connection.token}`;
      return;
    case "api_key_header":
      if (!connection.authHeaderName) {
        throw new Error("auth_type='api_key_header' requiere auth_header_name");
      }
      headers[connection.authHeaderName] = connection.token;
      return;
    case "basic":
      headers.Authorization = `Basic ${Buffer.from(connection.token, "utf8").toString("base64")}`;
      return;
  }
}

export function createRestClient(connection: RestConnection) {
  return {
    async request<T>(options: RequestOptions): Promise<RestResult<T>> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        applyAuth(headers, connection);

        const response = await fetch(`${connection.baseUrl}${options.path}`, {
          method: options.method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => undefined);
          return {
            ok: false,
            error: {
              code: "http_error",
              message: `${connection.baseUrl}${options.path} respondió ${response.status}`,
              details: { status: response.status, body },
            },
          };
        }

        const data = (await response.json()) as T;
        return { ok: true, data };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return {
            ok: false,
            error: { code: "timeout", message: `Timeout de ${timeoutMs}ms alcanzado` },
          };
        }
        const message = error instanceof Error ? error.message : "Error de red desconocido";
        return {
          ok: false,
          error: { code: "http_error", message, details: { status: 0, body: undefined } },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
