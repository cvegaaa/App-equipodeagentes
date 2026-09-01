import { and, desc, eq } from "drizzle-orm";
import type { ChatMessage } from "@/components/chat/chat-thread";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";

const HISTORY_LIMIT = 20;

/**
 * Historial de un hilo de chat — compartido entre el chat de Aux Contable, el chat de un agente
 * custom y el copiloto de plataforma (misma forma de datos, distinto `agentType`/`triggerType`).
 * Filtra por `agentType` explícito: antes de que existiera más de un agente por organización, un
 * `orgId` alcanzaba — ahora hace falta o el historial de un agente se mezclaría con el de otro.
 */
export async function loadChatHistory(params: {
  orgId: string;
  agentType: string;
  triggerType: "chat_request" | "copilot_request";
}): Promise<ChatMessage[]> {
  const recentRuns = await db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.orgId, params.orgId),
        eq(runs.agentType, params.agentType),
        eq(runs.triggerType, params.triggerType),
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(HISTORY_LIMIT);

  return recentRuns
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .flatMap((run) => {
      const input = run.input as { message?: string } | null;
      const result = run.result as { text?: string } | null;
      const userMessage: ChatMessage = {
        id: `${run.id}-user`,
        role: "user",
        content: input?.message ?? "(mensaje vacío)",
      };
      if (run.status === "succeeded") {
        return [
          userMessage,
          { id: `${run.id}-assistant`, role: "assistant", content: result?.text ?? "" },
        ];
      }
      if (run.status === "queued" || run.status === "running") {
        return [
          userMessage,
          {
            id: `${run.id}-assistant`,
            role: "assistant",
            content: "El agente sigue procesando esta solicitud…",
            pending: true,
          },
        ];
      }
      return [
        userMessage,
        {
          id: `${run.id}-assistant`,
          role: "assistant",
          content: `El agente no pudo completar esta solicitud (${run.status}).`,
          failed: true,
        },
      ];
    });
}
