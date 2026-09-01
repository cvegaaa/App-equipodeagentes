"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE } from "@/server/active-org";

/** Cambia la organización activa (cookie) — el llamador ya validó que el usuario es miembro. */
export async function setActiveOrgAction(formData: FormData): Promise<void> {
  const orgId = formData.get("orgId");
  if (typeof orgId !== "string" || orgId.length === 0) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/app");
}
