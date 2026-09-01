import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/webhooks/whatsapp/route";
import { db } from "@/lib/db";
import { agentConfig, organization, runs } from "@/lib/db/schema";
import { env } from "@/lib/env";

const org = { id: randomUUID(), slug: `whatsapp-webhook-test-${randomUUID()}` };
const whatsappNumber = `57300${Math.floor(Math.random() * 10_000_000)}`;

beforeAll(async () => {
  await db
    .insert(organization)
    .values({ id: org.id, name: "Org de prueba", slug: org.slug, whatsappNumber });
  await db.insert(agentConfig).values({ orgId: org.id, enabled: true });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org.id));
});

function sign(rawBody: string): string {
  const digest = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  return `sha256=${digest}`;
}

function messagesPayload(from: string, text: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1", phone_number_id: "1" },
              messages: [{ from, id: `wamid-${randomUUID()}`, type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

describe("GET /api/webhooks/whatsapp — verificación", () => {
  it("responde el challenge cuando el verify_token coincide", async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${env.WHATSAPP_WEBHOOK_VERIFY_TOKEN}&hub.challenge=abc123`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  it("responde 403 si el verify_token no coincide", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=abc123",
    );
    const response = await GET(request);
    expect(response.status).toBe(403);
  });
});

describe("POST /api/webhooks/whatsapp — firma", () => {
  it("responde 403 si la firma no coincide, sin encolar ningún run", async () => {
    const body = messagesPayload(whatsappNumber, "hola");
    const request = new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=firma-incorrecta" },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(403);

    const matchingRuns = await db.select().from(runs).where(eq(runs.orgId, org.id));
    expect(matchingRuns).toHaveLength(0);
  });
});

describe("POST /api/webhooks/whatsapp — mensajes", () => {
  it("un mensaje de un número mapeado encola un run chat_request con el canal de respuesta", async () => {
    const body = messagesPayload(whatsappNumber, "¿cuánto facturé esta semana?");
    const request = new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body) },
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
    expect(input.replyChannel).toBe("whatsapp");
    expect(input.replyTo).toBe(whatsappNumber);
    expect(matchingRuns[0].triggerType).toBe("chat_request");
  });

  it("un mensaje de un número no mapeado a ninguna organización se ignora sin error", async () => {
    const unknownNumber = `573009999999`;
    const body = messagesPayload(unknownNumber, "hola");
    const request = new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(body) },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});
