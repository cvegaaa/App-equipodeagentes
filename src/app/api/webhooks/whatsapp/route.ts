import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentConfig, organization } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { assertAgentEnabled } from "@/server/agent/aux-contable/definition";
import { enqueueJob } from "@/server/jobs/enqueue";

type IncomingMessage = { from: string; type: string; text?: { body?: string } };

// Handshake de verificación de Meta al configurar el webhook (una sola vez, desde su panel).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && challenge && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, error: { code: "forbidden" } }, { status: 403 });
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  const expectedHeader = `sha256=${expected}`;
  const expectedBuf = Buffer.from(expectedHeader);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

// Verifica la firma sobre el body CRUDO antes de parsearlo como JSON confiable
// (.claude/rules/api-routes.md, blueprint.md §14).
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ ok: false, error: { code: "forbidden" } }, { status: 403 });
  }

  const payload = JSON.parse(rawBody);
  const messages = payload?.entry?.[0]?.changes?.[0]?.value?.messages as
    | IncomingMessage[]
    | undefined;

  if (!messages?.length) {
    // Eventos de estado de entrega (sent/delivered/read) también llegan a este webhook — se
    // reconocen sin procesar, no son mensajes de un cliente.
    return NextResponse.json({ ok: true });
  }

  for (const message of messages) {
    const text = message.text?.body;
    if (!text) continue; // solo texto plano por ahora — audio/imagen se ignoran

    const [org] = await db
      .select()
      .from(organization)
      .where(eq(organization.whatsappNumber, message.from));
    if (!org) continue; // número no mapeado a ninguna organización — se ignora en silencio

    const [config] = await db.select().from(agentConfig).where(eq(agentConfig.orgId, org.id));
    if (!assertAgentEnabled(config).ok) continue;

    await enqueueJob("chat_request", {
      orgId: org.id,
      input: { message: text, replyChannel: "whatsapp", replyTo: message.from },
    });
  }

  return NextResponse.json({ ok: true });
}
