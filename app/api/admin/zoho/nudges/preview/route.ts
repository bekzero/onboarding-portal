import { NextResponse } from "next/server";
import { getAdminApiAuthError } from "@/lib/admin-auth";
import { getZohoNudgeSummary, previewZohoNudges } from "@/lib/zoho-nudge-engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = await getAdminApiAuthError();
  if (authError) return authError;
  const url = new URL(request.url);
  const takeValue = Number(url.searchParams.get("take") ?? 50);
  const take = Number.isFinite(takeValue) ? Math.max(1, Math.min(100, Math.trunc(takeValue))) : 50;
  const [preview, summary] = await Promise.all([
    previewZohoNudges({ cursor: url.searchParams.get("cursor") || undefined, take }),
    getZohoNudgeSummary()
  ]);
  return NextResponse.json({ ...preview, summary });
}
