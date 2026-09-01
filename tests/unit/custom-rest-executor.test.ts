import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCustomRestTool } from "@/lib/connectors/custom-rest-executor";
import { assertSafeExternalUrl } from "@/lib/connectors/url-guard";

vi.mock("@/lib/connectors/url-guard", () => ({
  assertSafeExternalUrl: vi.fn(async () => ({ ok: true as const })),
}));

const ctx = {
  connection: {
    baseUrl: "https://api.cliente.test",
    authType: "bearer_token" as const,
    token: "tok",
  },
  idempotencyKey: "idem-1",
  orgId: "org-1",
  input: {},
};

const operation = {
  name: "get_order",
  description: "Consulta un pedido por id",
  method: "GET" as const,
  path: "/orders/:id",
  inputSchema: {
    properties: { id: { type: "string" }, includeItems: { type: "boolean" } },
    required: ["id"],
  },
  idempotent: false,
};

describe("buildCustomRestTool", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rechaza argumentos inválidos sin llegar a hacer fetch", async () => {
    const tool = buildCustomRestTool(operation, "https://api.cliente.test");
    const result = await tool.handler({}, ctx); // falta 'id', requerido
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza cuando el guard SSRF marca la URL como insegura, sin hacer fetch", async () => {
    vi.mocked(assertSafeExternalUrl).mockResolvedValueOnce({
      ok: false,
      error: { code: "unsafe_url", message: "no" },
    });
    const tool = buildCustomRestTool(operation, "http://169.254.169.254");
    const result = await tool.handler({ id: "42" }, ctx);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sustituye :id en la ruta y manda el resto como query string en GET", async () => {
    const tool = buildCustomRestTool(operation, "https://api.cliente.test");
    await tool.handler({ id: "42", includeItems: true }, ctx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cliente.test/orders/42?includeItems=true");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("manda el body en POST y usa el token vía Authorization Bearer", async () => {
    const postOperation = {
      ...operation,
      name: "create_note",
      method: "POST" as const,
      path: "/notes",
      inputSchema: { properties: { text: { type: "string" } }, required: ["text"] },
    };
    const tool = buildCustomRestTool(postOperation, "https://api.cliente.test");
    await tool.handler({ text: "hola" }, ctx);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cliente.test/notes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hola" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});
