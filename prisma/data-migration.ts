/**
 * Data Migration Script — Multi-Tenancy
 *
 * Migrates existing single-tenant data to multi-tenant schema:
 * 1. Creates a "Default Salon" from current Settings
 * 2. Sets salonId and role on all existing User records
 * 3. Sets salonId on all existing tenant-scoped records
 *
 * Run AFTER the schema migration that adds nullable salonId columns,
 * and BEFORE the migration that makes salonId required.
 *
 * Usage: npx tsx prisma/data-migration.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Starting multi-tenancy data migration...\n");

  // Step 1: Get current settings to populate salon info (read before transaction)
  const settings = await prisma.settings.findFirst();
  const salonName = settings?.salonName ?? "Default Salon";
  const salonSlug = salonName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Use raw query to read users — Prisma will crash if the DB has a SUPER_ADMIN
  // enum value that no longer exists in the schema's Role enum (P2023 error).
  const users = await prisma.$queryRaw<Array<{ id: string; role: string | null }>>`
    SELECT id, role::text AS role FROM "users"
  `;

  // Run all mutation steps in a single transaction
  const validRoles = new Set(["OWNER", "ADMIN", "STAFF", "RECEPTIONIST"]);
  const { salon, userCount, totalRecords } = await prisma.$transaction(async (tx) => {
    // Step 2: Create the default salon
    const salon = await tx.salon.create({
      data: {
        name: salonName,
        slug: salonSlug,
        address: settings?.salonAddress,
        phone: settings?.salonPhone,
        email: settings?.salonEmail,
        logo: settings?.salonLogo,
        subscriptionStatus: "ACTIVE",
        subscriptionPlan: "PRO",
      },
    });

    // Step 3: Set salonId and role on existing users
    let userCount = 0;

    for (const user of users) {
      const oldRole = user.role ?? undefined;

      if (oldRole === "SUPER_ADMIN") {
        await tx.user.update({
          where: { id: user.id },
          data: { isSuperAdmin: true, salonId: salon.id, role: "OWNER" },
        });
      } else if (oldRole && validRoles.has(oldRole)) {
        await tx.user.update({
          where: { id: user.id },
          data: {
            salonId: salon.id,
            role: oldRole as "OWNER" | "ADMIN" | "STAFF" | "RECEPTIONIST",
          },
        });
      } else {
        throw new Error(`User ${user.id} has no migratable role: ${String(oldRole)}`);
      }
      userCount++;
    }

    // Step 4: Set salonId on all tenant-scoped models
    const updates = await Promise.all([
      tx.settings.updateMany({ data: { salonId: salon.id } }),
      tx.client.updateMany({ data: { salonId: salon.id } }),
      tx.service.updateMany({ data: { salonId: salon.id } }),
      tx.product.updateMany({ data: { salonId: salon.id } }),
      tx.appointment.updateMany({ data: { salonId: salon.id } }),
      tx.sale.updateMany({ data: { salonId: salon.id } }),
      tx.saleItem.updateMany({ data: { salonId: salon.id } }),
      tx.invoice.updateMany({ data: { salonId: salon.id } }),
      tx.schedule.updateMany({ data: { salonId: salon.id } }),
      tx.loyaltyPoints.updateMany({ data: { salonId: salon.id } }),
      tx.loyaltyTransaction.updateMany({ data: { salonId: salon.id } }),
      tx.recurringAppointmentSeries.updateMany({ data: { salonId: salon.id } }),
      tx.auditLog.updateMany({ data: { salonId: salon.id } }),
    ]);

    const totalRecords = updates.reduce((sum, r) => sum + r.count, 0);

    return { salon, userCount, totalRecords };
  });

  console.log(`✅ Created default salon: "${salon.name}" (${salon.id})`);
  console.log(`✅ Updated ${userCount} users with salonId and role`);
  console.log(`✅ Updated ${totalRecords} records with salonId across 13 models`);

  console.log("\n🎉 Data migration complete!");
  console.log(`   Default salon ID: ${salon.id}`);
  console.log(`   Default salon slug: ${salon.slug}`);
  console.log("\n   Next step: Run the migration to make salonId columns NOT NULL");
}

main()
  .catch((e) => {
    console.error("❌ Data migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
