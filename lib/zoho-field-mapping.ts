import type { ZohoLeadField } from "./zoho-api-core";

export const ZOHO_CUSTOM_FIELDS = [
  ["Plan ID", "Text"],
  ["Tenant Type", "Picklist"],
  ["Portal URL", "URL"],
  ["Current Phase", "Picklist"],
  ["Onboarding Progress", "Percent"],
  ["Onboarding Role", "Picklist"],
  ["Onboarding State", "Picklist"],
  ["Next Task ID", "Text"],
  ["Next Task Title", "Text"],
  ["Next Task Owner", "Picklist"],
  ["Next Task Status", "Picklist"],
  ["Next Task Minutes", "Integer"],
  ["Next Task Link", "URL"],
  ["Next Task Tip", "Text"],
  ["Next Task Guide URL", "URL"],
  ["Next Task Since", "Date and Time"],
  ["Last MSP Activity", "Date and Time"],
  ["Last SE Touch", "Date and Time"],
  ["Apps Submitted", "Integer"],
  ["Apps Approved", "Integer"],
  ["SE Name", "Text"],
  ["SE Email", "Email"],
  ["SE Booking URL", "URL"],
  ["Nudge Status", "Text"]
] as const;

export const ZOHO_BUILT_IN_FIELDS = ["Lead Email", "First Name", "Last Name"] as const;

// Zoho accepts these fields in discovery, but listsubscribe currently rejects
// their datetime values with application code 2001. Keep discovering and
// storing them; omit them only at the outbound API boundary.
export const ZOHO_LISTSUBSCRIBE_EXCLUDED_FIELDS = [
  "Next Task Since",
  "Last MSP Activity",
  "Last SE Touch"
] as const;

const listSubscribeExcludedFields = new Set<string>(ZOHO_LISTSUBSCRIBE_EXCLUDED_FIELDS);

export const ZOHO_LISTSUBSCRIBE_FIELDS = [
  ...ZOHO_BUILT_IN_FIELDS,
  ...ZOHO_CUSTOM_FIELDS
    .map(([name]) => name)
    .filter((name) => !listSubscribeExcludedFields.has(name))
] as ZohoContactDisplayField[];

export type ZohoContactDisplayField =
  | (typeof ZOHO_BUILT_IN_FIELDS)[number]
  | (typeof ZOHO_CUSTOM_FIELDS)[number][0];

export type ZohoFieldDiscoveryEntry = {
  allowedValues: string[] | null;
  dataType: string | null;
  expectedField: string;
  expectedType: string;
  found: boolean;
  mappingStatus:
    | "FOUND"
    | "FOUND_IDENTIFIER_TYPE_UNVERIFIED"
    | "TYPE_MISMATCH"
    | "MISSING"
    | "AMBIGUOUS"
    | "IDENTIFIER_MISSING";
  zohoFieldId: string | null;
  zohoIdentifier: string | null;
};

function canonicalType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    bigint: "integer",
    dateandtime: "datetime",
    datetime: "datetime",
    dropdown: "picklist",
    emailaddress: "email",
    int: "integer",
    number: "integer",
    percentage: "percent",
    string: "text",
    varchar: "text"
  };
  return aliases[normalized] ?? normalized;
}

function typeMatches(actual: string, expected: string) {
  return canonicalType(actual) === canonicalType(expected);
}

function normalizeDisplayName(value: string) {
  return value.trim().toLowerCase();
}

const metadataDisplayNames: Partial<Record<ZohoContactDisplayField, readonly string[]>> = {
  // Marketing Automation discovery calls this built-in field "Contact Email",
  // while listsubscribe accepts the verified outbound key "Lead Email".
  "Lead Email": ["Lead Email", "Contact Email"]
};

const expectedBuiltInTypes: Record<(typeof ZOHO_BUILT_IN_FIELDS)[number], string> = {
  "Lead Email": "Email",
  "First Name": "Text",
  "Last Name": "Text"
};

function findMatches(fields: ZohoLeadField[], expectedField: string) {
  const acceptedNames = metadataDisplayNames[expectedField as ZohoContactDisplayField] ?? [expectedField];
  const normalized = new Set(acceptedNames.map(normalizeDisplayName));
  return fields.filter((field) => normalized.has(normalizeDisplayName(field.displayName)));
}

function expectedTypeFor(expectedField: string) {
  if (expectedField in expectedBuiltInTypes) {
    return expectedBuiltInTypes[expectedField as (typeof ZOHO_BUILT_IN_FIELDS)[number]];
  }
  return ZOHO_CUSTOM_FIELDS.find(([name]) => name === expectedField)?.[1] ?? null;
}

function validIdentifier(expectedField: string, field: ZohoLeadField) {
  if (!field.fieldName.trim()) return false;
  if (expectedField === "Lead Email" && normalizeDisplayName(field.displayName) === "contact email") {
    return field.fieldName.trim().toLowerCase() === "contact_email";
  }
  if (expectedField === "Next Task Tip") {
    return field.fieldName.trim().toUpperCase() === "CONTACT_CF32";
  }
  return true;
}

export function buildZohoFieldDiscoveryReport(fields: ZohoLeadField[]): ZohoFieldDiscoveryEntry[] {
  return ZOHO_CUSTOM_FIELDS.map(([expectedField, expectedType]) => {
    const matches = findMatches(fields, expectedField);
    if (matches.length === 0) {
      return {
        allowedValues: null,
        dataType: null,
        expectedField,
        expectedType,
        found: false,
        mappingStatus: "MISSING" as const,
        zohoFieldId: null,
        zohoIdentifier: null
      };
    }
    if (matches.length > 1) {
      return {
        allowedValues: null,
        dataType: null,
        expectedField,
        expectedType,
        found: true,
        mappingStatus: "AMBIGUOUS" as const,
        zohoFieldId: null,
        zohoIdentifier: null
      };
    }
    const match = matches[0];
    return {
      allowedValues: match.allowedValues,
      dataType: match.dataType,
      expectedField,
      expectedType,
      found: true,
      mappingStatus: match.fieldName.trim()
        ? match.dataType
          ? typeMatches(match.dataType, expectedType)
            ? "FOUND"
            : "TYPE_MISMATCH"
          : "FOUND_IDENTIFIER_TYPE_UNVERIFIED"
        : "IDENTIFIER_MISSING",
      zohoFieldId: match.fieldId,
      zohoIdentifier: match.fieldName.trim() || null
    };
  });
}

export function getZohoFieldIdentifierMap(fields: ZohoLeadField[]) {
  const expectedFields: string[] = [...ZOHO_BUILT_IN_FIELDS, ...ZOHO_CUSTOM_FIELDS.map(([name]) => name)];
  const identifiers: Record<string, string> = {};
  const missing: string[] = [];

  for (const expectedField of expectedFields) {
    const matches = findMatches(fields, expectedField);
    const expectedType = expectedTypeFor(expectedField);
    const match = matches[0];
    if (
      matches.length !== 1 ||
      !match ||
      !validIdentifier(expectedField, match) ||
      match.dataType === null ||
      expectedType === null ||
      !typeMatches(match.dataType, expectedType)
    ) {
      missing.push(expectedField);
    } else {
      identifiers[expectedField] = match.fieldName;
    }
  }

  return { identifiers, missing, ready: missing.length === 0 };
}

export function buildZohoLeadInfo(
  snapshot: Record<ZohoContactDisplayField, string | number | null>,
  fields: ZohoLeadField[]
) {
  const mapping = getZohoFieldIdentifierMap(fields);
  if (!mapping.ready) {
    throw new Error(`Zoho field mapping is incomplete: ${mapping.missing.join(", ")}.`);
  }

  return Object.fromEntries(
    ZOHO_LISTSUBSCRIBE_FIELDS.map((displayName) => {
      const fieldValue = snapshot[displayName];
      return [displayName, fieldValue ?? ""];
    })
  ) as Record<string, string | number>;
}
