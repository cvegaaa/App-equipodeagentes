import { describe, expect, it, vi } from "vitest";
import { assertSafeExternalUrl } from "@/lib/connectors/url-guard";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => {
    if (hostname === "api.cliente-publico.test") {
      return [{ address: "203.0.113.10", family: 4 }];
    }
    if (hostname === "interno-redirigido.test") {
      // simula un dominio cuyo DNS apunta a la red interna — el caso que el guard debe atrapar
      // aunque el hostname en sí no "parezca" privado.
      return [{ address: "10.0.0.5", family: 4 }];
    }
    if (hostname === "no-resuelve.test") {
      throw new Error("ENOTFOUND");
    }
    return [{ address: "203.0.113.1", family: 4 }];
  }),
}));

describe("assertSafeExternalUrl", () => {
  it("rechaza protocolos que no son http/https", async () => {
    const result = await assertSafeExternalUrl("ftp://api.cliente-publico.test/x");
    expect(result.ok).toBe(false);
  });

  it("rechaza una URL inválida", async () => {
    const result = await assertSafeExternalUrl("no-es-una-url");
    expect(result.ok).toBe(false);
  });

  it("rechaza localhost explícito", async () => {
    const result = await assertSafeExternalUrl("http://localhost:3000/api");
    expect(result.ok).toBe(false);
  });

  it.each([
    "http://127.0.0.1/api",
    "http://10.1.2.3/api",
    "http://172.16.5.5/api",
    "http://192.168.1.1/api",
    "http://169.254.169.254/latest/meta-data", // metadata de nube — caso real de SSRF
    "http://0.0.0.0/api",
  ])("rechaza la IP privada/loopback literal %s", async (url) => {
    const result = await assertSafeExternalUrl(url);
    expect(result.ok).toBe(false);
  });

  it("rechaza cuando el hostname resuelve a una IP privada (DNS rebinding)", async () => {
    const result = await assertSafeExternalUrl("https://interno-redirigido.test/api");
    expect(result.ok).toBe(false);
  });

  it("rechaza un hostname que no resuelve", async () => {
    const result = await assertSafeExternalUrl("https://no-resuelve.test/api");
    expect(result.ok).toBe(false);
  });

  it("permite una IP pública literal", async () => {
    const result = await assertSafeExternalUrl("https://203.0.113.10/api");
    expect(result.ok).toBe(true);
  });

  it("permite un hostname que resuelve a una IP pública", async () => {
    const result = await assertSafeExternalUrl("https://api.cliente-publico.test/api");
    expect(result.ok).toBe(true);
  });
});
