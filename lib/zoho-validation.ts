import "server-only";
import type { PlanContactRole } from "@prisma/client";
import { normalizeZohoRecipientEmail } from "@/lib/zoho-foundation";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_ROLES = new Set<PlanContactRole>([
  "ONBOARDING_OWNER",
  "EXECUTIVE_SPONSOR",
  "TECHNICAL_ADMIN"
]);

export class ZohoAdminValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ZohoAdminValidationError";
  }
}

function normalizeOptionalText(value: unknown, label: string, maxLength: number) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ZohoAdminValidationError(`${label} must be text.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ZohoAdminValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }

  return trimmed || null;
}

export function isValidEmailAddress(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

export function normalizeRequiredEmail(value: unknown, label = "Email address") {
  if (typeof value !== "string" || !value.trim()) {
    throw new ZohoAdminValidationError(`${label} is required.`);
  }

  const email = value.trim();
  if (email.length > 320 || !isValidEmailAddress(email)) {
    throw new ZohoAdminValidationError(`Enter a valid ${label.toLowerCase()}.`);
  }

  return {
    email,
    normalizedEmail: normalizeZohoRecipientEmail(email)
  };
}

export function normalizeOptionalEmail(value: unknown, label: string) {
  const email = normalizeOptionalText(value, label, 320);
  if (email && !isValidEmailAddress(email)) {
    throw new ZohoAdminValidationError(`Enter a valid ${label.toLowerCase()}.`);
  }

  return email;
}

export function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizeOptionalBookingUrl(value: unknown) {
  const bookingUrl = normalizeOptionalText(value, "Sales Engineer booking URL", 2048);
  if (bookingUrl && !isValidHttpUrl(bookingUrl)) {
    throw new ZohoAdminValidationError("Enter a valid Sales Engineer booking URL using http or https.");
  }

  return bookingUrl;
}

export function normalizeSalesEngineerInput(input: {
  email?: unknown;
  name?: unknown;
  bookingUrl?: unknown;
}) {
  return {
    assignedSeBookingUrl: normalizeOptionalBookingUrl(input.bookingUrl),
    assignedSeEmail: normalizeOptionalEmail(input.email, "Sales Engineer email"),
    assignedSeName: normalizeOptionalText(input.name, "Sales Engineer name", 200)
  };
}

export function normalizePlanContactInput(input: {
  automationEnabled?: unknown;
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  role?: unknown;
}) {
  const { email, normalizedEmail } = normalizeRequiredEmail(input.email);
  if (typeof input.role !== "string" || !CONTACT_ROLES.has(input.role as PlanContactRole)) {
    throw new ZohoAdminValidationError("Select a valid contact role.");
  }
  if (input.automationEnabled !== undefined && typeof input.automationEnabled !== "boolean") {
    throw new ZohoAdminValidationError("Automation eligibility must be true or false.");
  }

  return {
    automationEnabled: input.automationEnabled === true,
    email,
    firstName: normalizeOptionalText(input.firstName, "First name", 100),
    lastName: normalizeOptionalText(input.lastName, "Last name", 100),
    normalizedEmail,
    role: input.role as PlanContactRole
  };
}
