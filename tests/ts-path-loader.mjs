import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { shortCircuit: true, url: "data:text/javascript,export%20default%20undefined" };
  }
  if (specifier === "@/lib/prisma" && process.env.ZOHO_RECONCILIATION_DB_TEST === "1") {
    return nextResolve(new URL("./zoho-prisma-test-client.mjs", import.meta.url).href, context);
  }
  if (specifier.startsWith("@/")) {
    return nextResolve(pathToFileURL(resolvePath(process.cwd(), `${specifier.slice(2)}.ts`)).href, context);
  }
  return nextResolve(specifier, context);
}
