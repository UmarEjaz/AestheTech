import { PrismaClient, Role, LoyaltyTier, Currency } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed...");

  // Clean existing data (order matters for foreign keys)
  await prisma.auditLog.deleteMany();
  await prisma.recurringSeriesAuditLog.deleteMany();
  await prisma.recurringSeriesException.deleteMany();
  await prisma.recurringAppointmentSeries.deleteMany();
  await prisma.loyaltyTransaction.deleteMany();
  await prisma.loyaltyPoints.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.service.deleteMany();
  await prisma.client.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.user.deleteMany();
  await prisma.salon.deleteMany();

  console.log("🗑️  Cleared existing data");

  // Create Default Salon
  const salon = await prisma.salon.create({
    data: {
      name: "AestheTech Salon",
      slug: "aesthetech-salon",
      address: "123 Beauty Street, Suite 100",
      phone: "+1234567890",
      email: "info@aesthetech.com",
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "PRO",
    },
  });

  console.log("🏪 Created salon");

  // Create Settings (1:1 with Salon)
  await prisma.settings.create({
    data: {
      salonId: salon.id,
      salonName: "AestheTech Salon",
      currency: Currency.USD,
      currencySymbol: "$",
      taxRate: 0,
      businessHoursStart: "09:00",
      businessHoursEnd: "19:00",
      appointmentInterval: 30,
      allowOnlineBooking: true,
      loyaltyPointsPerDollar: 1,
    },
  });

  console.log("⚙️  Created settings");

  // Create Users with role and salonId directly
  const hashedPassword = await bcrypt.hash("password123", 10);
  const superAdminPassword = await bcrypt.hash("umar111", 10);

  // Create Super Admin (platform-level flag + OWNER role at default salon)
  const superAdmin = await prisma.user.create({
    data: {
      email: "itsumarejaz@gmail.com",
      password: superAdminPassword,
      firstName: "Umar",
      lastName: "Ejaz",
      phone: "+923001234567",
      isSuperAdmin: true,
      salonId: salon.id,
      role: Role.OWNER,
    },
  });

  const owner = await prisma.user.create({
    data: {
      email: "owner@aesthetech.com",
      password: hashedPassword,
      firstName: "Sarah",
      lastName: "Johnson",
      phone: "+1234567890",
      salonId: salon.id,
      role: Role.OWNER,
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: "admin@aesthetech.com",
      password: hashedPassword,
      firstName: "Michael",
      lastName: "Chen",
      phone: "+1234567891",
      salonId: salon.id,
      role: Role.ADMIN,
    },
  });

  const staff1 = await prisma.user.create({
    data: {
      email: "emma@aesthetech.com",
      password: hashedPassword,
      firstName: "Emma",
      lastName: "Wilson",
      phone: "+1234567892",
      salonId: salon.id,
      role: Role.STAFF,
    },
  });

  const staff2 = await prisma.user.create({
    data: {
      email: "james@aesthetech.com",
      password: hashedPassword,
      firstName: "James",
      lastName: "Brown",
      phone: "+1234567893",
      salonId: salon.id,
      role: Role.STAFF,
    },
  });

  await prisma.user.create({
    data: {
      email: "lisa@aesthetech.com",
      password: hashedPassword,
      firstName: "Lisa",
      lastName: "Martinez",
      phone: "+1234567894",
      salonId: salon.id,
      role: Role.RECEPTIONIST,
    },
  });

  console.log("👤 Created users");

  // Create Services (salon-scoped)
  const services = await Promise.all([
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Haircut - Women",
        description: "Professional haircut for women including wash and style",
        duration: 60,
        price: 75.0,
        points: 75,
        category: "Hair",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Haircut - Men",
        description: "Professional haircut for men",
        duration: 30,
        price: 35.0,
        points: 35,
        category: "Hair",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Hair Coloring",
        description: "Full hair coloring service",
        duration: 120,
        price: 150.0,
        points: 150,
        category: "Hair",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Highlights",
        description: "Partial or full highlights",
        duration: 90,
        price: 120.0,
        points: 120,
        category: "Hair",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Blowout",
        description: "Professional blow dry and styling",
        duration: 45,
        price: 50.0,
        points: 50,
        category: "Hair",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Manicure",
        description: "Classic manicure with polish",
        duration: 30,
        price: 30.0,
        points: 30,
        category: "Nails",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Pedicure",
        description: "Classic pedicure with polish",
        duration: 45,
        price: 45.0,
        points: 45,
        category: "Nails",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Gel Nails",
        description: "Gel manicure with UV cure",
        duration: 60,
        price: 55.0,
        points: 55,
        category: "Nails",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Facial - Basic",
        description: "Basic facial treatment",
        duration: 60,
        price: 80.0,
        points: 80,
        category: "Skincare",
      },
    }),
    prisma.service.create({
      data: {
        salonId: salon.id,
        name: "Facial - Premium",
        description: "Premium facial with advanced treatments",
        duration: 90,
        price: 150.0,
        points: 150,
        category: "Skincare",
      },
    }),
  ]);

  console.log("💇 Created services");

  // Create Products (salon-scoped)
  await Promise.all([
    prisma.product.create({
      data: {
        salonId: salon.id,
        name: "Argan Oil Shampoo",
        description: "Nourishing shampoo with argan oil for smooth, shiny hair",
        sku: "PROD-001",
        price: 24.99,
        cost: 12.00,
        stock: 25,
        lowStockThreshold: 5,
        points: 25,
        category: "Hair Care",
      },
    }),
    prisma.product.create({
      data: {
        salonId: salon.id,
        name: "Deep Conditioning Mask",
        description: "Intensive repair treatment for damaged hair",
        sku: "PROD-002",
        price: 34.99,
        cost: 15.00,
        stock: 18,
        lowStockThreshold: 5,
        points: 35,
        category: "Hair Care",
      },
    }),
    prisma.product.create({
      data: {
        salonId: salon.id,
        name: "Gel Nail Polish Set",
        description: "Set of 6 trending gel nail colors",
        sku: "PROD-003",
        price: 45.00,
        cost: 20.00,
        stock: 12,
        lowStockThreshold: 3,
        points: 45,
        category: "Nails",
      },
    }),
    prisma.product.create({
      data: {
        salonId: salon.id,
        name: "Cuticle Oil",
        description: "Vitamin E enriched cuticle moisturizer",
        sku: "PROD-004",
        price: 12.99,
        cost: 5.00,
        stock: 30,
        lowStockThreshold: 8,
        points: 13,
        category: "Nails",
      },
    }),
    prisma.product.create({
      data: {
        salonId: salon.id,
        name: "Hyaluronic Acid Serum",
        description: "Professional-grade hydrating serum",
        sku: "PROD-005",
        price: 59.99,
        cost: 25.00,
        stock: 8,
        lowStockThreshold: 5,
        points: 60,
        category: "Skincare",
      },
    }),
    prisma.product.create({
      data: {
        salonId: salon.id,
        name: "SPF 50 Sunscreen",
        description: "Lightweight daily sun protection",
        sku: "PROD-006",
        price: 28.00,
        cost: 10.00,
        stock: 3,
        lowStockThreshold: 5,
        points: 28,
        category: "Skincare",
      },
    }),
  ]);

  console.log("📦 Created products");

  // Create Clients (salon-scoped)
  const clients = await Promise.all([
    prisma.client.create({
      data: {
        salonId: salon.id,
        firstName: "Jennifer",
        lastName: "Smith",
        email: "jennifer.smith@email.com",
        phone: "+1555000001",
        birthday: new Date("1990-05-15"),
        preferences: "Prefers organic products",
        tags: ["regular", "vip"],
      },
    }),
    prisma.client.create({
      data: {
        salonId: salon.id,
        firstName: "David",
        lastName: "Lee",
        email: "david.lee@email.com",
        phone: "+1555000002",
        birthday: new Date("1985-08-22"),
        notes: "Always on time",
        tags: ["regular"],
      },
    }),
    prisma.client.create({
      data: {
        salonId: salon.id,
        firstName: "Maria",
        lastName: "Garcia",
        email: "maria.garcia@email.com",
        phone: "+1555000003",
        birthday: new Date("1992-12-03"),
        allergies: "Sensitive to strong fragrances",
        tags: ["new"],
      },
    }),
    prisma.client.create({
      data: {
        salonId: salon.id,
        firstName: "Robert",
        lastName: "Taylor",
        email: "robert.taylor@email.com",
        phone: "+1555000004",
        preferences: "Prefers afternoon appointments",
        tags: ["regular"],
      },
    }),
    prisma.client.create({
      data: {
        salonId: salon.id,
        firstName: "Amanda",
        lastName: "White",
        email: "amanda.white@email.com",
        phone: "+1555000005",
        birthday: new Date("1988-03-28"),
        tags: ["vip"],
      },
    }),
  ]);

  console.log("👥 Created clients");

  // Create Loyalty Points for clients (salon-scoped)
  await Promise.all(
    clients.map((client, index) =>
      prisma.loyaltyPoints.create({
        data: {
          salonId: salon.id,
          clientId: client.id,
          balance: [500, 250, 100, 750, 1200][index],
          tier: [
            LoyaltyTier.GOLD,
            LoyaltyTier.SILVER,
            LoyaltyTier.SILVER,
            LoyaltyTier.GOLD,
            LoyaltyTier.PLATINUM,
          ][index],
        },
      })
    )
  );

  console.log("⭐ Created loyalty points");

  // Create Staff Schedules (salon-scoped)
  const daysOfWeek = [1, 2, 3, 4, 5]; // Monday to Friday
  for (const staff of [staff1, staff2]) {
    for (const day of daysOfWeek) {
      await prisma.schedule.create({
        data: {
          salonId: salon.id,
          staffId: staff.id,
          dayOfWeek: day,
          startTime: "09:00",
          endTime: "17:00",
          shiftType: "REGULAR",
          isAvailable: true,
        },
      });
    }
  }

  console.log("📅 Created staff schedules");

  // Create some sample appointments for today and upcoming days (salon-scoped)
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  await prisma.appointment.create({
    data: {
      salonId: salon.id,
      clientId: clients[0].id,
      serviceId: services[0].id, // Women's haircut
      staffId: staff1.id,
      startTime: new Date(today.setHours(10, 0, 0, 0)),
      endTime: new Date(today.setHours(11, 0, 0, 0)),
      status: "SCHEDULED",
    },
  });

  await prisma.appointment.create({
    data: {
      salonId: salon.id,
      clientId: clients[1].id,
      serviceId: services[1].id, // Men's haircut
      staffId: staff2.id,
      startTime: new Date(today.setHours(14, 0, 0, 0)),
      endTime: new Date(today.setHours(14, 30, 0, 0)),
      status: "CONFIRMED",
    },
  });

  await prisma.appointment.create({
    data: {
      salonId: salon.id,
      clientId: clients[2].id,
      serviceId: services[8].id, // Basic facial
      staffId: staff1.id,
      startTime: new Date(tomorrow.setHours(11, 0, 0, 0)),
      endTime: new Date(tomorrow.setHours(12, 0, 0, 0)),
      status: "SCHEDULED",
    },
  });

  console.log("📆 Created appointments");

  console.log("✅ Seed completed successfully!");
  console.log("");
  console.log("📋 Test Accounts:");
  console.log("   Super Admin: itsumarejaz@gmail.com / umar111");
  console.log("   Owner: owner@aesthetech.com / password123");
  console.log("   Admin: admin@aesthetech.com / password123");
  console.log("   Staff: emma@aesthetech.com / password123");
  console.log("   Staff: james@aesthetech.com / password123");
  console.log("   Receptionist: lisa@aesthetech.com / password123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
