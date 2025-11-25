#!/bin/bash

# Database Testing Script
# This script tests database connectivity and runs database-related tests

set -e

echo "🗄️  Database Test Suite"
echo "======================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}❌ DATABASE_URL environment variable not set${NC}"
    echo "Please set DATABASE_URL in your .env file"
    exit 1
fi

# Test database connection
echo -e "${YELLOW}🔌 Testing database connection...${NC}"
if npx prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Database connection successful${NC}"
else
    echo -e "${RED}✗ Database connection failed${NC}"
    exit 1
fi

echo ""

# Check if Prisma Client is generated
echo -e "${YELLOW}⚙️  Checking Prisma Client...${NC}"
if [ -d "node_modules/.prisma" ]; then
    echo -e "${GREEN}✓ Prisma Client exists${NC}"
else
    echo -e "${YELLOW}⚠️  Prisma Client not found. Generating...${NC}"
    npx prisma generate
    echo -e "${GREEN}✓ Prisma Client generated${NC}"
fi

echo ""

# Check migration status
echo -e "${YELLOW}📋 Checking migration status...${NC}"
npx prisma migrate status

echo ""

# Run database-related tests
echo -e "${YELLOW}🧪 Running database tests...${NC}"
if npm test -- --testPathPattern="db|database|prisma"; then
    echo -e "${GREEN}✓ Database tests passed${NC}"
else
    echo -e "${RED}✗ Database tests failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ All database checks passed!${NC}"
echo ""
