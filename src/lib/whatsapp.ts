import { env } from "@/lib/env";

// Módulo HTTPS plano para la WhatsApp Cloud API (Meta) — sin SDK, según el stack del proyecto.
const WHATSAPP_API_VERSION = "v21.0";

type SendWhatsAppResult =
  | { ok: true }
  | { ok: false; error: { code: "whatsapp_send_failed"; message: string } };

/** Envía un mensaje de texto plano por WhatsApp. Nunca lanza — errores de red/API vuelven como resultado. */
export async function sendWhatsAppMessage(to: string, text: string): Promise<SendWhatsAppResult> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      return {
        ok: false,
        error: {
          code: "whatsapp_send_failed",
          message: `WhatsApp Cloud API respondió ${response.status}: ${JSON.stringify(body)}`,
        },
      };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de red desconocido";
    return { ok: false, error: { code: "whatsapp_send_failed", message } };
  }
}
