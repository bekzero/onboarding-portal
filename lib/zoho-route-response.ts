import "server-only";
import { NextResponse } from "next/server";
import { getSanitizedZohoError, getZohoApiErrorStatus } from "@/lib/zoho-api";
import { getZohoAdminErrorStatus } from "@/lib/zoho-admin";
import { ZohoAdminValidationError } from "@/lib/zoho-validation";

export function zohoAdminErrorResponse(error: unknown) {
  const sanitized = getSanitizedZohoError(error);
  const status = sanitized.kind === "UNEXPECTED" ? getZohoAdminErrorStatus(error) : getZohoApiErrorStatus(error);
  const message =
    sanitized.kind === "UNEXPECTED"
      ? error instanceof ZohoAdminValidationError
        ? error.message
        : "The Zoho operation could not be completed."
      : sanitized.message;
  return NextResponse.json({ error: message, classification: sanitized.kind }, { status });
}
