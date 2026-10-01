import { NextRequest, NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { createMsp, getAdminDashboardCases, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;

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
  const authError = await getAdminApiAuthError();
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      accessMode: "temporary" | "oidc";
      assignedSalesEngineer?: string;
      customerName?: string;
      enrollmentDate?: string;
      isGmmPartner?: boolean;
      name: string;
      planType?: "nfr" | "customer";
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
