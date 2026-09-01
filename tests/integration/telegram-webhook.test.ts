import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/telegram/route";
import { db } from "@/lib/db";
import { agentConfig, organization, runs } from "@/lib/db/schema";
import { env } from "@/lib/env";

const org = { id: randomUUID(), slug: `telegram-webhook-test-${randomUUID()}` };
const telegramChatId = String(Math.floor(Math.random() * 1_000_000_000));

beforeAll(async () => {
  await db
    .insert(organization)
    .values({ id: org.id, name: "Org de prueba", slug: org.slug, telegramChatId });
  await db.insert(agentConfig).values({ orgId: org.id, enabled: true });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org.id));
});

function updatePayload(chatId: string, text: string) {
  return JSON.stringify({
    update_id: 1,
    message: { message_id: 1, chat: { id: Number(chatId) }, text },
  });
}

describe("POST /api/webhooks/telegram — secret token", () => {
  it("responde 403 si el secret token no coincide, sin encolar ningún run", async () => {
    const body = updatePayload(telegramChatId, "hola");
    const request = new NextRequest("http://localhost:3000/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "secreto-incorrecto" },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(403);

    const matchingRuns = await db.select().from(runs).where(eq(runs.orgId, org.id));
    expect(matchingRuns).toHaveLength(0);
  });
});

describe("POST /api/webhooks/telegram — mensajes", () => {
  it("un mensaje de un chat mapeado encola un run chat_request con el canal de respuesta", async () => {
    const body = updatePayload(telegramChatId, "¿cuánto facturé esta semana?");
    const request = new NextRequest("http://localhost:3000/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(200);

    const matchingRuns = await db.select().from(runs).where(eq(runs.orgId, org.id));
    expect(matchingRuns).toHaveLength(1);
    const input = matchingRuns[0].input as {
      message: string;
      replyChannel: string;
      replyTo: string;
    };
    expect(input.message).toBe("¿cuánto facturé esta semana?");
    expect(input.replyChannel).toBe("telegram");
    expect(input.replyTo).toBe(telegramChatId);
    expect(matchingRuns[0].triggerType).toBe("chat_request");
  });

  it("un mensaje de un chat no mapeado a ninguna organización se ignora sin error", async () => {
    const unknownChatId = "999999999";
    const body = updatePayload(unknownChatId, "hola");
    const request = new NextRequest("http://localhost:3000/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("un update sin texto (p. ej. un sticker) se reconoce sin encolar ningún run", async () => {
    const body = JSON.stringify({
      update_id: 2,
      message: { message_id: 2, chat: { id: Number(telegramChatId) } },
    });
    const request = new NextRequest("http://localhost:3000/api/webhooks/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});
