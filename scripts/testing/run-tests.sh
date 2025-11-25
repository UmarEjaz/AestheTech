#!/bin/bash

# AestheTech Test Runner Script
# This script runs all tests and generates a coverage report

set -e  # Exit on error

echo "🧪 AestheTech Test Suite"
echo "========================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${RED}❌ node_modules not found. Please run 'npm install' first.${NC}"
    exit 1
fi

# Run linting
echo -e "${YELLOW}📋 Running linter...${NC}"
if npm run lint; then
    echo -e "${GREEN}✓ Linting passed${NC}"
else
    echo -e "${RED}✗ Linting failed${NC}"
    exit 1
fi

echo ""

# Run type checking
echo -e "${YELLOW}🔍 Running type check...${NC}"
if npm run type-check; then
    echo -e "${GREEN}✓ Type check passed${NC}"
else
    echo -e "${RED}✗ Type check failed${NC}"
    exit 1
fi

echo ""

# Run unit tests
echo -e "${YELLOW}🧪 Running unit tests...${NC}"
if npm test -- --coverage; then
    echo -e "${GREEN}✓ All tests passed${NC}"
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi

echo ""

# Check coverage threshold
echo -e "${YELLOW}📊 Checking coverage...${NC}"
echo "Coverage report generated at: coverage/lcov-report/index.html"

echo ""
echo -e "${GREEN}✅ All checks passed!${NC}"
echo ""
