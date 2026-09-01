import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage } from "@/lib/model-gateway";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
  },
}));

describe("sendMessage", () => {
  afterEach(() => {
    createMock.mockReset();
  });

  it("devuelve { ok: true, data: { text, usage } } con usage numérico en éxito", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "hola" }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
    });

    const result = await sendMessage({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).toBe("hola");
    expect(typeof result.data.usage.inputTokens).toBe("number");
    expect(typeof result.data.usage.outputTokens).toBe("number");
    expect(result.data.usage.inputTokens).toBe(10);
    expect(result.data.usage.outputTokens).toBe(5);
    expect(result.data.usage.cachedTokens).toBe(2);
  });

  it("concatena múltiples bloques de texto", async () => {
    createMock.mockResolvedValueOnce({
      content: [
        { type: "text", text: "hola " },
        { type: "text", text: "mundo" },
      ],
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null },
    });

    const result = await sendMessage({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).toBe("hola mundo");
    expect(result.data.usage.cachedTokens).toBe(0);
  });

  it("devuelve { ok: false, error: { code: 'model_call_failed' } } si el SDK lanza (red o rate limit)", async () => {
    createMock.mockRejectedValueOnce(new Error("rate limit exceeded"));

    const result = await sendMessage({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("model_call_failed");
    expect(result.error.message).toContain("rate limit exceeded");
  });
});
