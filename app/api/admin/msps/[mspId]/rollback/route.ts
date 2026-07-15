import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { rollbackPortalTaskForMsp } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mspId: string }> }
) {
  await requireAdminSession();

  try {
    const body = (await request.json()) as {
      taskId?: string;
    };
    const taskId = body.taskId?.trim();

    if (!taskId) {
      return NextResponse.json({ error: "A task must be selected to reopen." }, { status: 400 });
    }

    const { mspId } = await params;
    const bundle = await rollbackPortalTaskForMsp(mspId, taskId);

    if (!bundle) {
      return NextResponse.json({ error: "Onboarding plan not found." }, { status: 404 });
    }

    return NextResponse.json({ bundle });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reopen the selected onboarding step.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
