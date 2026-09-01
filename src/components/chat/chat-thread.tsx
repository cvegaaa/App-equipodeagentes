"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  failed?: boolean;
};

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "budget_exceeded"]);
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 40; // ~60s

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollRun(runId: string): Promise<{ text: string; failed: boolean }> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const response = await fetch(`/api/v1/runs/${runId}`);
    const body = await response.json();
    if (body.ok) {
      const status = body.data.run.status as string;
      if (TERMINAL_STATUSES.has(status)) {
        if (status === "succeeded") {
          return { text: body.data.run.result?.text ?? "(sin respuesta de texto)", failed: false };
        }
        return { text: `El agente no pudo completar esta solicitud (${status}).`, failed: true };
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { text: "Se agotó el tiempo de espera de la respuesta.", failed: true };
}

export function ChatThread({
  initialMessages,
  canSend,
  endpoint = "/api/v1/chat",
  agentType,
  emptyHint = 'Escríbele al Aux Contable — por ejemplo, "¿cuánto facturé esta semana?" o "genera una factura de venta a Juan Pérez".',
  disabledHint = "Solo un operador puede escribirle al agente — tu rol es de solo lectura.",
}: {
  initialMessages: ChatMessage[];
  canSend: boolean;
  /** @default "/api/v1/chat" */
  endpoint?: string;
  /** Se envía en el body del POST cuando está presente — omitido, el endpoint usa su default. */
  agentType?: string;
  emptyHint?: string;
  disabledHint?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleSend() {
    const text = draft.trim();
    if (!text || isSending) return;

    setDraft("");
    setIsSending(true);

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: userMessageId, role: "user", content: text },
      { id: assistantMessageId, role: "assistant", content: "Pensando…", pending: true },
    ]);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(agentType ? { message: text, agentType } : { message: text }),
      });
      const body = await response.json();
      if (!body.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: body.error?.message ?? "No se pudo enviar el mensaje.",
                  pending: false,
                  failed: true,
                }
              : m,
          ),
        );
        return;
      }

      const result = await pollRun(body.data.runId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: result.text, pending: false, failed: result.failed }
            : m,
        ),
      );
    } finally {
      setIsSending(false);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <div className="flex h-[calc(100vh-220px)] flex-col rounded-lg border border-border bg-card">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-sm text-muted-foreground">{emptyHint}</p>}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : message.failed
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-foreground"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {canSend ? (
        <div className="flex items-end gap-2 border-t border-border p-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="Escribe tu mensaje…"
            className="min-h-[44px] resize-none"
            disabled={isSending}
          />
          <Button onClick={handleSend} disabled={isSending || draft.trim().length === 0}>
            {isSending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      ) : (
        <div className="border-t border-border p-3 text-center text-sm text-muted-foreground">
          {disabledHint}
        </div>
      )}
    </div>
  );
}
