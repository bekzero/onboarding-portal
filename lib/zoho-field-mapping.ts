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

function findMatches(fields: ZohoLeadField[], expectedField: string) {
  const normalized = normalizeDisplayName(expectedField);
  return fields.filter((field) => normalizeDisplayName(field.displayName) === normalized);
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
    if (matches.length !== 1 || !matches[0].fieldName.trim()) {
      missing.push(expectedField);
    } else {
      identifiers[expectedField] = matches[0].fieldName;
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
    Object.entries(snapshot).map(([displayName, fieldValue]) => [
      mapping.identifiers[displayName],
      fieldValue ?? ""
    ])
  ) as Record<string, string | number>;
}
