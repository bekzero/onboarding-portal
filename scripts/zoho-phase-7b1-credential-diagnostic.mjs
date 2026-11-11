import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { parseEnv } from "node:util";

const credentialNames = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
const fallbackProfile = process.argv[2] === "fallback";
const runnerFiles = [
  ".env.zoho-test.local",
  ".env.zoho-readonly.local",
  ...(fallbackProfile ? [".env.zoho-readonly-fallback.local"] : [])
];
const otherFiles = [
  ".env",
  ".env.local",
  ...(!fallbackProfile ? [".env.zoho-readonly-fallback.local"] : [])
];

function fingerprint(value) {
  return value ? `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}` : null;
}

async function readEnvironmentFile(path) {
  try {
    return { exists: true, values: parseEnv(await readFile(path, "utf8")) };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { exists: false, values: {} };
    }
    throw error;
  }
}

const files = Object.fromEntries(await Promise.all(
  [...runnerFiles, ...otherFiles].map(async (path) => [path, await readEnvironmentFile(path)])
));

const variables = Object.fromEntries(credentialNames.map((name) => {
  const fileSources = [...runnerFiles, ...otherFiles].flatMap((path) => {
    const candidate = files[path].values[name]?.trim();
    return candidate ? [{ fingerprint: fingerprint(candidate), source: path }] : [];
  });
  const inherited = process.env[name]?.trim() ?? "";

  let effectiveValue = "";
  let effectiveSource = null;
  for (const path of runnerFiles) {
    const candidate = files[path].values[name]?.trim();
    if (candidate) {
      effectiveValue = candidate;
      effectiveSource = path;
    }
  }
  if (inherited) {
    effectiveValue = inherited;
    effectiveSource = "inherited-process-environment";
  }

  return [name, {
    conflictingFingerprints: new Set([
      ...fileSources.map((source) => source.fingerprint),
      ...(inherited ? [fingerprint(inherited)] : [])
    ]).size > 1,
    effectiveFingerprint: fingerprint(effectiveValue),
    effectiveSource,
    fileSources,
    inheritedProcessEnvironment: {
      fingerprint: fingerprint(inherited),
      present: Boolean(inherited)
    }
  }];
}));

const profileCredentialFile = fallbackProfile
  ? ".env.zoho-readonly-fallback.local"
  : ".env.zoho-readonly.local";
const profileReady = files[profileCredentialFile].exists &&
  credentialNames.every((name) => Boolean(files[profileCredentialFile].values[name]?.trim()));

console.log(JSON.stringify({
  cacheAssessment: "ACCESS_TOKEN_CACHE_IS_PROCESS_LOCAL_AND_EMPTY_ON_EACH_NPM_RUN",
  credentialProfile: fallbackProfile ? "fallback" : "primary",
  profileCredentialFile,
  profileReady,
  environmentPrecedence: [
    ...runnerFiles.map((path, index) => index === 0 ? path : `${path} overrides preceding files`),
    "inherited process environment overrides all files"
  ],
  files: Object.fromEntries(Object.entries(files).map(([path, file]) => [path, {
    credentialNamesPresent: credentialNames.filter((name) => Boolean(file.values[name]?.trim())),
    exists: file.exists,
    loadedByPhase7b1Runner: runnerFiles.includes(path)
  }])),
  variables
}, null, 2));

process.exitCode = profileReady ? 0 : 2;
