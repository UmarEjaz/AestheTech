/**
 * Data Migration Script — Multi-Tenancy
 *
 * Migrates existing single-tenant data to multi-tenant schema:
 * 1. Creates a "Default Salon" from current Settings
 * 2. Creates SalonMember records from existing User.role values
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

  const users = await prisma.user.findMany();

  // Run all mutation steps in a single transaction
  const { salon, memberCount, totalRecords } = await prisma.$transaction(async (tx) => {
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

    // Step 3: Create SalonMember records from existing users
    // Users with SUPER_ADMIN role get isSuperAdmin flag + OWNER membership
    // All other users get a membership with their current role
    let memberCount = 0;

    for (const user of users) {
      // Read the old role value via raw query since the column may still exist
      const oldRole = (user as Record<string, unknown>).role as string | undefined;

      if (oldRole === "SUPER_ADMIN") {
        // Set isSuperAdmin flag
        await tx.user.update({
          where: { id: user.id },
          data: { isSuperAdmin: true },
        });
        // Also give them OWNER role in the default salon
        await tx.salonMember.create({
          data: {
            userId: user.id,
            salonId: salon.id,
            role: "OWNER",
          },
        });
      } else if (oldRole) {
        await tx.salonMember.create({
          data: {
            userId: user.id,
            salonId: salon.id,
            role: oldRole as "OWNER" | "ADMIN" | "STAFF" | "RECEPTIONIST",
          },
        });
      }
      memberCount++;
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

    return { salon, memberCount, totalRecords };
  });

  console.log(`✅ Created default salon: "${salon.name}" (${salon.id})`);
  console.log(`✅ Created ${memberCount} salon memberships`);
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
