import { afterEach, describe, expect, it, vi } from "vitest";
import { createSalesInvoiceTool } from "@/lib/connectors/providers/alegra/tools";
import { createRestClient, type RestConnection } from "@/lib/connectors/rest-client";

const alegraConnection: RestConnection = {
  baseUrl: "https://api.alegra.com/api/v1",
  authType: "basic",
  token: "admin@geifem.com:test-token",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("alegra.create_sales_invoice — validación", () => {
  it("devuelve un error de validación estructurado, sin lanzar, si los args no cumplen el schema", async () => {
    const result = await createSalesInvoiceTool.handler(
      { clientId: "no-es-un-numero" },
      { connection: alegraConnection, idempotencyKey: "test-key-invalid" },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_error");
  });
});

describe("alegra.create_sales_invoice — idempotencia", () => {
  it("invocada dos veces con la misma clave de idempotencia, crea como máximo una factura", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: 1, number: "FV-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const args = { clientId: 1, items: [{ id: 1, price: 100, quantity: 1 }] };
    const idempotencyKey = `idem-${crypto.randomUUID()}`;

    const first = await createSalesInvoiceTool.handler(args, {
      connection: alegraConnection,
      idempotencyKey,
    });
    const second = await createSalesInvoiceTool.handler(args, {
      connection: alegraConnection,
      idempotencyKey,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (first.ok && second.ok) {
      expect(second.data).toEqual(first.data);
    }
  });
});

describe("rest-client — timeout (genérico, cualquier provider_key)", () => {
  it("devuelve { ok: false, error: { code: 'timeout' } } en vez de colgar la llamada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortError = new Error("The operation was aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        });
      }),
    );

    const client = createRestClient({
      baseUrl: "https://example-provider.test",
      authType: "bearer_token",
      token: "cualquier-token",
    });

    const result = await client.request({ method: "GET", path: "/ping", timeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("timeout");
  });
});

describe("rest-client — auth_type='api_key_header' (genérico, cualquier provider_key)", () => {
  it("inyecta el token en el header nombrado por auth_header_name", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: init?.headers }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createRestClient({
      baseUrl: "https://example-provider.test",
      authType: "api_key_header",
      authHeaderName: "X-Api-Key",
      token: "el-token-secreto",
    });

    await client.request({ method: "GET", path: "/ping" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("el-token-secreto");
    expect(headers.Authorization).toBeUndefined();
  });
});
