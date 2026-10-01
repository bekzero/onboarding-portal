import { NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { markAllAdminNotificationsRead } from "@/lib/admin-notifications";
import { isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  try {
    const updatedCount = await markAllAdminNotificationsRead();
    return NextResponse.json({ updatedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not mark notifications as read.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
