import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const schema = process.env.ZOHO_RECONCILIATION_TEST_SCHEMA;
const connectionString = process.env.DATABASE_URL;
if (!schema || !/^reconciliation_[0-9_]+$/.test(schema) || !connectionString) {
  throw new Error("The isolated reconciliation test database configuration is incomplete.");
}

const pool = new Pool({ connectionString, max: 8 });
export const prisma = new PrismaClient({
  adapter: new PrismaPg(pool, { disposeExternalPool: true, schema })
});
