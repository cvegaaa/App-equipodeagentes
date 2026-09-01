import { z } from "zod";

export const chatRequestSchema = z.object({
  message: z.string().min(1, "message no puede estar vacío").max(2000),
  // Puente hasta que exista un selector de organización activa en sesión (E3-T2) — si el usuario
  // tiene una sola membresía aceptada, se resuelve sola y este campo es opcional.
  orgId: z.string().uuid().optional(),
  // Agente de catálogo (p. ej. 'aux_contable', default) o agente custom ('custom:<uuid>') — ver
  // docs/plataforma-multiagente-pivot.md §3.
  agentType: z.string().min(1).default("aux_contable"),
});
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
