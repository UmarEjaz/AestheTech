-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'PKR');

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "salonName" TEXT NOT NULL DEFAULT 'AestheTech Salon',
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "currencySymbol" TEXT NOT NULL DEFAULT '$',
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "businessHoursStart" TEXT NOT NULL DEFAULT '09:00',
    "businessHoursEnd" TEXT NOT NULL DEFAULT '19:00',
    "appointmentInterval" INTEGER NOT NULL DEFAULT 30,
    "allowOnlineBooking" BOOLEAN NOT NULL DEFAULT true,
    "loyaltyPointsPerDollar" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);
