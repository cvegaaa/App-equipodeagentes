import { z } from "zod";

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvValidationError";
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  // URL pública de la app — better-auth la necesita para construir callbacks/redirects
  // correctamente en vez de derivarla del request (ambiguo detrás de un proxy/VPS).
  BETTER_AUTH_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL_ID: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  // Requerida desde E2-T3 (paso 9) — protege /api/cron/*.
  CRON_SECRET: z.string().min(1),
  // Requeridas desde E2-T6 (paso 12) — entrega del reporte semanal por correo/WhatsApp.
  RESEND_API_KEY: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  // Chat entrante por WhatsApp (a pedido del usuario, ver docs/decisiones §chat-and-channels).
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  // Chat entrante/saliente por Telegram (mismo pedido, canal siguiente en la prioridad acordada).
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
});

export function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new EnvValidationError(`Variables de entorno inválidas o ausentes: ${missing}`);
  }
  return result.data;
}

export const env = loadEnv();
