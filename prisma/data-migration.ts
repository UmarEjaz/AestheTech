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

  // Step 1: Get current settings to populate salon info
  const settings = await prisma.settings.findFirst();
  const salonName = settings?.salonName ?? "Default Salon";
  const salonSlug = salonName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Step 2: Create the default salon
  const salon = await prisma.salon.create({
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
  console.log(`✅ Created default salon: "${salon.name}" (${salon.id})`);

  // Step 3: Create SalonMember records from existing users
  // Users with SUPER_ADMIN role get isSuperAdmin flag + OWNER membership
  // All other users get a membership with their current role
  const users = await prisma.user.findMany();
  let memberCount = 0;

  for (const user of users) {
    // Read the old role value via raw query since the column may still exist
    const oldRole = (user as Record<string, unknown>).role as string | undefined;

    if (oldRole === "SUPER_ADMIN") {
      // Set isSuperAdmin flag
      await prisma.user.update({
        where: { id: user.id },
        data: { isSuperAdmin: true },
      });
      // Also give them OWNER role in the default salon
      await prisma.salonMember.create({
        data: {
          userId: user.id,
          salonId: salon.id,
          role: "OWNER",
        },
      });
    } else if (oldRole) {
      await prisma.salonMember.create({
        data: {
          userId: user.id,
          salonId: salon.id,
          role: oldRole as "OWNER" | "ADMIN" | "STAFF" | "RECEPTIONIST",
        },
      });
    }
    memberCount++;
  }
  console.log(`✅ Created ${memberCount} salon memberships`);

  // Step 4: Set salonId on all tenant-scoped models
  const updates = await Promise.all([
    prisma.settings.updateMany({ data: { salonId: salon.id } }),
    prisma.client.updateMany({ data: { salonId: salon.id } }),
    prisma.service.updateMany({ data: { salonId: salon.id } }),
    prisma.product.updateMany({ data: { salonId: salon.id } }),
    prisma.appointment.updateMany({ data: { salonId: salon.id } }),
    prisma.sale.updateMany({ data: { salonId: salon.id } }),
    prisma.saleItem.updateMany({ data: { salonId: salon.id } }),
    prisma.invoice.updateMany({ data: { salonId: salon.id } }),
    prisma.schedule.updateMany({ data: { salonId: salon.id } }),
    prisma.loyaltyPoints.updateMany({ data: { salonId: salon.id } }),
    prisma.loyaltyTransaction.updateMany({ data: { salonId: salon.id } }),
    prisma.recurringAppointmentSeries.updateMany({ data: { salonId: salon.id } }),
    prisma.auditLog.updateMany({ data: { salonId: salon.id } }),
  ]);

  const totalRecords = updates.reduce((sum, r) => sum + r.count, 0);
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
