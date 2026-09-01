import { config } from "dotenv";

// vitest does not load .env automatically — this file is vitest.config.ts's setupFiles entry and
// is the explicit env-loading mechanism for the test runner (see blueprint §19.6).
config({ path: ".env.test", override: false });
config({ path: ".env", override: false });

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
