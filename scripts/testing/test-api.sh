#!/bin/bash

# API Testing Script
# This script runs API endpoint tests

set -e

echo "🌐 API Test Suite"
echo "================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if server is running (optional)
# Uncomment if you want to test against a running server
# if ! curl -s http://localhost:3000 > /dev/null; then
#     echo -e "${YELLOW}⚠️  Development server not running. Starting...${NC}"
#     npm run dev &
#     SERVER_PID=$!
#     sleep 5  # Wait for server to start
# fi

# Run API tests
echo -e "${YELLOW}🧪 Running API tests...${NC}"
if npm test -- --testPathPattern="api|route"; then
    echo -e "${GREEN}✓ API tests passed${NC}"
else
    echo -e "${RED}✗ API tests failed${NC}"
    # Kill server if we started it
    # [ ! -z "$SERVER_PID" ] && kill $SERVER_PID
    exit 1
fi

# Kill server if we started it
# [ ! -z "$SERVER_PID" ] && kill $SERVER_PID

echo ""
echo -e "${GREEN}✅ All API tests passed!${NC}"
echo ""
