import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { markAllAdminNotificationsRead } from "@/lib/admin-notifications";
import { isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export async function POST() {
  await requireAdminSession();

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
