import "dotenv/config";
import { pollDianSync } from "@/server/jobs/dian-sync-poll";

pollDianSync()
  .then((result) => {
    console.log("dian-sync-poll listo:", result);
    process.exit(0);
  })
  .catch((error) => {
    console.error("dian-sync-poll falló:", error);
    process.exit(1);
  });
