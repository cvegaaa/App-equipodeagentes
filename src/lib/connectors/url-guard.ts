import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type UrlGuardError = { code: "unsafe_url"; message: string };
export type UrlGuardResult = { ok: true } | { ok: false; error: UrlGuardError };

// Rangos privados/loopback/link-local IPv4 (RFC 1918, RFC 3927, RFC 5735) — un conector
// autoservicio (custom_rest/mcp) nunca puede apuntar acá. Ver
// docs/conectores-roles-interactividad.md §1.4 — no-negociable, no opcional.
const PRIVATE_IPV4_RANGES: [string, number][] = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incluye metadata de nube — 169.254.169.254)
  ["0.0.0.0", 8],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

function isPrivateIpv4(ip: string): boolean {
  const target = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (target & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") ||
    lower.startsWith("fd") || // unique local (fc00::/7)
    lower.startsWith("::ffff:127.") || // v4-mapped loopback
    lower.startsWith("::ffff:10.") ||
    lower.startsWith("::ffff:192.168.")
  );
}

function isUnsafeIp(address: string, family: 4 | 6): boolean {
  return family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
}

/**
 * Bloquea que un conector autoservicio (custom_rest/mcp) apunte a la red interna del servidor —
 * SSRF, riesgo marcado como no-negociable al diseñar conectores autoservicio
 * (docs/conectores-roles-interactividad.md §1.4). Valida el hostname Y el resultado real de la
 * resolución DNS (defensa contra DNS rebinding con el hostname en sí) — nunca confía solo en el
 * string de la URL. Se corre tanto al guardar un conector como en cada ejecución (DNS puede
 * cambiar entre medio).
 *
 * Límite conocido de esta v1: queda una ventana entre esta validación y el `fetch` real en
 * `rest-client.ts` donde una respuesta DNS maliciosa podría, en teoría, cambiar entre medio
 * (TOCTOU) — fijar la IP resuelta para el `fetch` posterior sería la defensa completa; no
 * implementado todavía, documentado como hueco conocido en vez de asumido resuelto.
 */
export async function assertSafeExternalUrl(rawUrl: string): Promise<UrlGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: { code: "unsafe_url", message: "URL inválida" } };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      error: { code: "unsafe_url", message: "Solo se permiten URLs http:// o https://" },
    };
  }

  const hostname = parsed.hostname;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, error: { code: "unsafe_url", message: "No se permite localhost" } };
  }

  const ipFamily = isIP(hostname);
  if (ipFamily === 4 || ipFamily === 6) {
    if (isUnsafeIp(hostname, ipFamily)) {
      return {
        ok: false,
        error: {
          code: "unsafe_url",
          message: "No se permiten IPs privadas, loopback o link-local",
        },
      };
    }
    return { ok: true };
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return {
      ok: false,
      error: { code: "unsafe_url", message: `No se pudo resolver el dominio '${hostname}'` },
    };
  }

  for (const { address, family } of addresses) {
    if (isUnsafeIp(address, family === 6 ? 6 : 4)) {
      return {
        ok: false,
        error: {
          code: "unsafe_url",
          message: `'${hostname}' resuelve a una IP privada/loopback (${address}) — no permitido`,
        },
      };
    }
  }

  return { ok: true };
}
