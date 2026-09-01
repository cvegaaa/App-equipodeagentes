import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { agentConfig, organization } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { assertAgentEnabled } from "@/server/agent/aux-contable/definition";
import { enqueueJob } from "@/server/jobs/enqueue";

const updateSchema = z.object({
  message: z
    .object({
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
    })
    .optional(),
});

function verifySecret(headerValue: string | null): boolean {
  if (!headerValue) return false;
  const expectedBuf = Buffer.from(env.TELEGRAM_WEBHOOK_SECRET);
  const actualBuf = Buffer.from(headerValue);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

// Telegram no tiene handshake GET como WhatsApp — la autenticidad se verifica con el secret_token
// que Telegram reenvía tal cual en cada POST (configurado una vez al registrar el webhook con
// setWebhook), comparado en tiempo constante antes de tocar el body como JSON confiable
// (.claude/rules/api-routes.md).
export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false, error: { code: "forbidden" } }, { status: 403 });
  }

  const rawBody = await request.text();
  const parsed = updateSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success || !parsed.data.message?.text) {
    // updates sin mensaje de texto (ediciones, stickers, comandos de canal, etc.) se reconocen sin
    // procesar — no son consultas de un cliente.
    return NextResponse.json({ ok: true });
  }

  const chatId = String(parsed.data.message.chat.id);
  const text = parsed.data.message.text;

  const [org] = await db.select().from(organization).where(eq(organization.telegramChatId, chatId));
  if (!org) return NextResponse.json({ ok: true }); // chat no mapeado a ninguna organización

  const [config] = await db.select().from(agentConfig).where(eq(agentConfig.orgId, org.id));
  if (!assertAgentEnabled(config).ok) return NextResponse.json({ ok: true });

  await enqueueJob("chat_request", {
    orgId: org.id,
    input: { message: text, replyChannel: "telegram", replyTo: chatId },
  });

  return NextResponse.json({ ok: true });
}
