import { redirect } from "next/navigation";
import { readPortalOidcSession } from "@/lib/oidc-session";

export default async function PortalResolvePage() {
  const portalSession = await readPortalOidcSession();

  if (!portalSession?.authenticated || !portalSession.planId) {
    redirect("/start?error=session_required");
  }

  redirect(`/portal/${portalSession.planId}`);
}
