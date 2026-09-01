import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: ".env.test", override: false });
config({ path: ".env", override: false });

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL / DATABASE_URL no está definido");

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

migrate(db, { migrationsFolder: "./drizzle" })
  .then(() => {
    console.log("[migrate-test-db] migraciones aplicadas a la base de datos de test.");
    return pool.end();
  })
  .catch((error) => {
    console.error("[migrate-test-db] fallo:", error);
    process.exit(1);
  });
