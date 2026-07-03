import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { createMsp, getAdminDashboardCases, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export async function GET() {
  await requireAdminSession();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  try {
    return NextResponse.json({
      msps: await getAdminDashboardCases()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load MSP records.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  await requireAdminSession();

  try {
    const body = (await request.json()) as {
      accessMode: "temporary" | "oidc";
      assignedSalesEngineer?: string;
      enrollmentDate?: string;
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
