import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { markAdminNotificationRead } from "@/lib/admin-notifications";
import { isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> }
) {
  await requireAdminSession();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  try {
    const { notificationId } = await params;
    const notification = await markAdminNotificationRead(notificationId);
    return NextResponse.json({ notification });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not mark the notification as read.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
