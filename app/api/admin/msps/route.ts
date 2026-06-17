import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { createMsp, isDatabasePersistenceConfigured } from "@/lib/msp-persistence";
import { prisma } from "@/lib/prisma";

export async function GET() {
  await requireAdminSession();

  if (!isDatabasePersistenceConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  const msps = await prisma.msp.findMany({
    include: {
      oidcConfig: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return NextResponse.json({
    msps: msps.map((msp) => ({
      accessMode: msp.accessMode,
      assignedSalesEngineer: msp.assignedSalesEngineer,
      createdAt: msp.createdAt,
      id: msp.id,
      name: msp.name,
      primaryContactEmail: msp.primaryContactEmail,
      slug: msp.slug,
      tenantRealm: msp.oidcConfig?.tenantRealm,
      updatedAt: msp.updatedAt
    }))
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

    const msp = await createMsp(body);
    return NextResponse.json({ msp }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create MSP.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
