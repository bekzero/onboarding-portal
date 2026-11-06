import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getZohoCronSecret, getZohoDispatchConfiguration } from "@/lib/zoho-config";
import { dispatchZohoOutboxBatch } from "@/lib/zoho-dispatcher";

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
  const config = getZohoDispatchConfiguration();
  if (!config.automaticDispatchEnabled) {
    return NextResponse.json({ error: "Automatic Zoho dispatch is disabled." }, { status: 503 });
  }
  const result = await dispatchZohoOutboxBatch();
  return NextResponse.json(result);
}
