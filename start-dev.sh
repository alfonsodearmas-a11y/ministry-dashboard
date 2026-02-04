#!/bin/bash
# Start local development environment

echo "🚀 Ministry Dashboard - Local Development"
echo "=========================================="
echo ""
echo "Starting SSH tunnel to database..."
echo "(Keep this terminal open)"
echo ""

cd "$(dirname "$0")/backend"
npm run tunnel
