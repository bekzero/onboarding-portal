import { createHash } from "node:crypto";

export const ISOLATION_CONFIRMATION = "I_CONFIRM_PHASE7A_IS_ISOLATED";
export const BACKUP_CONFIRMATION = "I_CONFIRM_PHASE7A_BACKUP_RESTORE_VERIFIED";
export const EMPTY_INITIALIZATION_CONFIRMATION = "I_CONFIRM_PHASE7A_INITIALIZE_EMPTY_DATABASE";
export const EXPECTED_RESOURCE_NAME = "kzero-onboarding-zoho-testing";

function parsePostgresUrl(value, variableName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${variableName} must use the postgres or postgresql protocol.`);
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName) throw new Error(`${variableName} must name a database.`);
  return { parsed, databaseName };
}

function connectionIdentity(parsed, databaseName) {
  return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${databaseName.toLowerCase()}`;
}

export function getPhase7aTarget({ requireBackup = false, requireEmptyInitialization = false } = {}) {
  const connectionString = process.env.ZOHO_PHASE7A_DATABASE_URL?.trim();
  const directConnectionString = process.env.ZOHO_PHASE7A_DIRECT_URL?.trim();
  const resourceName = process.env.ZOHO_PHASE7A_DATABASE_RESOURCE_NAME?.trim();
  if (!connectionString) {
    throw new Error(
      "ZOHO_PHASE7A_DATABASE_URL is required. Generic DATABASE_URL/DIRECT_URL values are never accepted by the Phase 7A harness."
    );
  }
  if (!directConnectionString) {
    throw new Error("ZOHO_PHASE7A_DIRECT_URL is required for isolated Prisma migration operations.");
  }
  if (resourceName !== EXPECTED_RESOURCE_NAME) {
    throw new Error(`ZOHO_PHASE7A_DATABASE_RESOURCE_NAME must be exactly ${EXPECTED_RESOURCE_NAME}.`);
  }
  if (process.env.ZOHO_PHASE7A_ISOLATED_CONFIRMATION !== ISOLATION_CONFIRMATION) {
    throw new Error(`Set ZOHO_PHASE7A_ISOLATED_CONFIRMATION=${ISOLATION_CONFIRMATION} after independently verifying the target.`);
  }

  const { parsed, databaseName } = parsePostgresUrl(connectionString, "ZOHO_PHASE7A_DATABASE_URL");
  const direct = parsePostgresUrl(directConnectionString, "ZOHO_PHASE7A_DIRECT_URL");
  const identity = connectionIdentity(parsed, databaseName);
  const directIdentity = connectionIdentity(direct.parsed, direct.databaseName);
  if (databaseName.toLowerCase() !== direct.databaseName.toLowerCase()) {
    throw new Error("The pooled and direct Phase 7A URLs must name the same PostgreSQL database.");
  }
  if (identity === directIdentity) {
    throw new Error("The pooled and direct Phase 7A connection identities must be distinct.");
  }
  for (const variableName of ["DATABASE_URL", "DIRECT_URL"]) {
    const candidate = process.env[variableName]?.trim();
    if (!candidate) continue;
    const parsedCandidate = parsePostgresUrl(candidate, variableName);
    if (connectionIdentity(parsedCandidate.parsed, parsedCandidate.databaseName) === identity) {
      throw new Error(`Phase 7A refused a target matching ${variableName}. Use a separately restored isolated database.`);
    }
    if (connectionIdentity(parsedCandidate.parsed, parsedCandidate.databaseName) === directIdentity) {
      throw new Error(`Phase 7A refused a direct target matching ${variableName}. Use a separately restored isolated database.`);
    }
  }

  if (/prod(?:uction)?/i.test(databaseName)) {
    throw new Error("Phase 7A refuses database names containing prod/production.");
  }

  if (requireBackup) {
    if (process.env.ZOHO_PHASE7A_BACKUP_RESTORE_CONFIRMED !== BACKUP_CONFIRMATION) {
      throw new Error(`Set ZOHO_PHASE7A_BACKUP_RESTORE_CONFIRMED=${BACKUP_CONFIRMATION} only after a restore has been verified.`);
    }
    if (!process.env.ZOHO_PHASE7A_BACKUP_RESTORE_REFERENCE?.trim()) {
      throw new Error("ZOHO_PHASE7A_BACKUP_RESTORE_REFERENCE is required for migration rehearsal.");
    }
  }
  if (
    requireEmptyInitialization &&
    process.env.ZOHO_PHASE7A_EMPTY_INITIALIZATION_CONFIRMATION !== EMPTY_INITIALIZATION_CONFIRMATION
  ) {
    throw new Error(
      `Set ZOHO_PHASE7A_EMPTY_INITIALIZATION_CONFIRMATION=${EMPTY_INITIALIZATION_CONFIRMATION} only after approving full migration of the verified empty test database.`
    );
  }

  return {
    connectionString,
    directConnectionString,
    databaseFingerprint: createHash("sha256").update(identity).digest("hex").slice(0, 16),
    directDatabaseFingerprint: createHash("sha256").update(directIdentity).digest("hex").slice(0, 16),
    databaseName,
    hostKind: ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase()) ? 'local' : 'remote-isolated'
  };
}

export function safeTargetSummary(target) {
  return {
    databaseFingerprint: target.databaseFingerprint,
    directDatabaseFingerprint: target.directDatabaseFingerprint,
    hostKind: target.hostKind,
    isolationConfirmation: true,
    resourceName: EXPECTED_RESOURCE_NAME
  };
}
