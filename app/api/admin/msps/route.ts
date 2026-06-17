import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { createMsp, getAdminDashboardCases, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export async function GET() {
  await requireAdminSession();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  return NextResponse.json({
    msps: await getAdminDashboardCases()
  });
}

export async function POST(request: NextRequest) {
  await requireAdminSession();

  try {
    const body = (await request.json()) as {
      accessMode: "temporary" | "oidc";
      assignedSalesEngineer?: string;
      name: string;
      primaryContactEmail: string;
      slug?: string;
    };

    const adminCase = await createMsp(body);
    return NextResponse.json({ msp: adminCase }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create MSP.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
