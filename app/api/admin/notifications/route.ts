import { NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { getAdminNotifications } from "@/lib/admin-notifications";
import { isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  try {
    const notifications = await getAdminNotifications();
    const unreadCount = notifications.filter((notification) => !notification.isRead).length;
    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load notifications.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
