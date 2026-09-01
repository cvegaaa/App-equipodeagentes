import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { membership, organization, user } from "@/lib/db/schema";

async function seed() {
  const [org] = await db
    .insert(organization)
    .values({ name: "GEIFEM (piloto)", slug: "geifem-piloto" })
    .returning();

  const [admin] = await db
    .insert(user)
    .values({
      id: randomUUID(),
      email: "admin@geifem.com",
      name: "GEIFEM Admin",
      platformRole: "platform_admin",
    })
    .returning();

  await db.insert(membership).values({
    userId: admin.id,
    orgId: org.id,
    role: "owner",
    acceptedAt: new Date(),
  });

  console.log(`Seed listo: org=${org.slug} admin=${admin.email}`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
