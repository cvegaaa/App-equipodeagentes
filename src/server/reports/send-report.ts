import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { weeklyReport } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

const resend = new Resend(env.RESEND_API_KEY);

type SendWeeklyReportResult = { emailSent: boolean; whatsappSent: boolean };

/**
 * Envía un `weekly_report` ya generado por correo (Resend) y, si hay número, por WhatsApp. Un
 * fallo de WhatsApp nunca lanza — se registra y `sent_whatsapp_at` queda nulo; el correo sigue su
 * propio camino independiente.
 */
export async function sendWeeklyReport(
  reportId: string,
  recipient: { email: string; whatsappNumber?: string },
): Promise<SendWeeklyReportResult> {
  const [report] = await db.select().from(weeklyReport).where(eq(weeklyReport.id, reportId));
  if (!report) {
    throw new Error(`weekly_report ${reportId} no existe`);
  }

  let emailSent = false;
  const emailResult = await resend.emails.send({
    from: "GEIFEM Agentes <reportes@geifem.com>",
    to: recipient.email,
    subject: "Tu reporte semanal de GEIFEM Agentes",
    text: report.content,
  });
  if (!emailResult.error) {
    await db
      .update(weeklyReport)
      .set({ sentEmailAt: new Date() })
      .where(eq(weeklyReport.id, reportId));
    emailSent = true;
  }

  let whatsappSent = false;
  if (recipient.whatsappNumber) {
    const whatsappResult = await sendWhatsAppMessage(recipient.whatsappNumber, report.content);
    if (whatsappResult.ok) {
      await db
        .update(weeklyReport)
        .set({ sentWhatsappAt: new Date() })
        .where(eq(weeklyReport.id, reportId));
      whatsappSent = true;
    } else {
      console.error(
        `[send-report] WhatsApp falló para weekly_report=${reportId}:`,
        whatsappResult.error.message,
      );
    }
  }

  return { emailSent, whatsappSent };
}
