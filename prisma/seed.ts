import { PrismaClient, Role, LoyaltyTier, Currency } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting seed...");

  // Clean existing data
  await prisma.settings.deleteMany();
  await prisma.loyaltyTransaction.deleteMany();
  await prisma.loyaltyPoints.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.service.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  console.log("🗑️  Cleared existing data");

  // Create Settings
  await prisma.settings.create({
    data: {
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

  // Create Users (Staff)
  const hashedPassword = await bcrypt.hash("password123", 10);
  const superAdminPassword = await bcrypt.hash("umar111", 10);

  // Create Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      email: "itsumarejaz@gmail.com",
      password: superAdminPassword,
      role: Role.SUPER_ADMIN,
      firstName: "Umar",
      lastName: "Ejaz",
      phone: "+923001234567",
    },
  });

  const owner = await prisma.user.create({
    data: {
      email: "owner@aesthetech.com",
      password: hashedPassword,
      role: Role.OWNER,
      firstName: "Sarah",
      lastName: "Johnson",
      phone: "+1234567890",
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: "admin@aesthetech.com",
      password: hashedPassword,
      role: Role.ADMIN,
      firstName: "Michael",
      lastName: "Chen",
      phone: "+1234567891",
    },
  });

  const staff1 = await prisma.user.create({
    data: {
      email: "emma@aesthetech.com",
      password: hashedPassword,
      role: Role.STAFF,
      firstName: "Emma",
      lastName: "Wilson",
      phone: "+1234567892",
    },
  });

  const staff2 = await prisma.user.create({
    data: {
      email: "james@aesthetech.com",
      password: hashedPassword,
      role: Role.STAFF,
      firstName: "James",
      lastName: "Brown",
      phone: "+1234567893",
    },
  });

  const receptionist = await prisma.user.create({
    data: {
      email: "lisa@aesthetech.com",
      password: hashedPassword,
      role: Role.RECEPTIONIST,
      firstName: "Lisa",
      lastName: "Martinez",
      phone: "+1234567894",
    },
  });

  console.log("👤 Created users");

  // Create Services
  const services = await Promise.all([
    prisma.service.create({
      data: {
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

  // Create Products
  await Promise.all([
    prisma.product.create({
      data: {
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

  // Create Clients
  const clients = await Promise.all([
    prisma.client.create({
      data: {
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

  // Create Loyalty Points for clients
  await Promise.all(
    clients.map((client, index) =>
      prisma.loyaltyPoints.create({
        data: {
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

  // Create Staff Schedules
  const daysOfWeek = [1, 2, 3, 4, 5]; // Monday to Friday
  for (const staff of [staff1, staff2]) {
    for (const day of daysOfWeek) {
      await prisma.schedule.create({
        data: {
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

  // Create some sample appointments for today and upcoming days
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  await prisma.appointment.create({
    data: {
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
