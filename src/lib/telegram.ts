import { env } from "@/lib/env";

// Módulo HTTPS plano para la Telegram Bot API — sin SDK, mismo patrón que src/lib/whatsapp.ts.

type SendTelegramResult =
  | { ok: true }
  | { ok: false; error: { code: "telegram_send_failed"; message: string } };

/** Envía un mensaje de texto plano por Telegram. Nunca lanza — errores de red/API vuelven como resultado. */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<SendTelegramResult> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      return {
        ok: false,
        error: {
          code: "telegram_send_failed",
          message: `Telegram Bot API respondió ${response.status}: ${JSON.stringify(body)}`,
        },
      };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de red desconocido";
    return { ok: false, error: { code: "telegram_send_failed", message } };
  }
}
