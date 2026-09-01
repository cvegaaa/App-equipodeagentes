import { z } from "zod";

export const copilotRequestSchema = z.object({
  message: z.string().min(1, "message no puede estar vacío").max(2000),
});
export type CopilotRequestInput = z.infer<typeof copilotRequestSchema>;
