import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getZohoCronSecret } from "@/lib/zoho-config";
import { runDailyZohoNudgeEvaluation } from "@/lib/zoho-nudge-engine";

export const dynamic = "force-dynamic";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function authorized(request: Request) {
  const secret = getZohoCronSecret();
  if (secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(provided), digest(secret));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    return NextResponse.json(await runDailyZohoNudgeEvaluation());
  } catch {
    return NextResponse.json({ error: "The Zoho nudge evaluation failed safely." }, { status: 500 });
  }
}
