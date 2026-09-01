import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  TextBlock,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { env } from "@/lib/env";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

export type ModelMessage = {
  role: "user" | "assistant";
  content: string | ContentBlockParam[];
};

export type ModelTool = Pick<Tool, "name" | "description" | "input_schema">;
export type ModelContentBlock = TextBlock | ToolUseBlock;

type SendMessageParams = {
  system?: string;
  messages: ModelMessage[];
  maxTokens: number;
  /** Tools disponibles para este turno — omitir si el llamador no necesita tool-calling. */
  tools?: ModelTool[];
};

type SendMessageResult =
  | {
      ok: true;
      data: {
        text: string;
        content: ModelContentBlock[];
        stopReason: string | null;
        usage: ModelUsage;
      };
    }
  | { ok: false; error: { code: "model_call_failed"; message: string } };

// Único módulo que instancia el SDK de Anthropic (CLAUDE.md — regla de fronteras). El id de
// modelo viene siempre de ANTHROPIC_MODEL_ID (env.ts), nunca hardcodeado aquí. `content` expone
// los bloques crudos (texto y tool_use) para que el agent loop pueda decidir si debe ejecutar una
// herramienta; `text` sigue siendo la concatenación de los bloques de texto, para llamadores que
// no necesitan tool-calling (p. ej. el generador de reportes).
export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  try {
    const response = await client.messages.create({
      model: env.ANTHROPIC_MODEL_ID,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages as MessageParam[],
      tools: params.tools as Tool[] | undefined,
    });

    const content = response.content.filter(
      (block): block is ModelContentBlock => block.type === "text" || block.type === "tool_use",
    );
    const text = content
      .filter((block): block is TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      ok: true,
      data: {
        text,
        content,
        stopReason: response.stop_reason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cachedTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown model gateway error";
    return { ok: false, error: { code: "model_call_failed", message } };
  }
}
