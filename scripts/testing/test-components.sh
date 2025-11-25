#!/bin/bash

# Component Testing Script
# This script runs React component tests

set -e

echo "⚛️  Component Test Suite"
echo "======================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Run component tests
echo -e "${YELLOW}🧪 Running component tests...${NC}"
if npm test -- --testPathPattern="components"; then
    echo -e "${GREEN}✓ Component tests passed${NC}"
else
    echo -e "${RED}✗ Component tests failed${NC}"
    exit 1
fi

echo ""

# Run accessibility tests if available
echo -e "${YELLOW}♿ Running accessibility tests...${NC}"
if npm test -- --testPathPattern="a11y|accessibility"; then
    echo -e "${GREEN}✓ Accessibility tests passed${NC}"
else
    echo -e "${YELLOW}⚠️  No accessibility tests found or tests failed${NC}"
fi

echo ""
echo -e "${GREEN}✅ Component tests completed!${NC}"
echo ""
