#!/bin/zsh
# Start GramCare AI website
# Compiles the C server and launches the site at http://localhost:8080

set -e

echo "========================================"
echo "  GramCare AI - Starting Server"
echo "========================================"

# Check if gcc is available
if ! command -v gcc &> /dev/null; then
    echo "ERROR: gcc not found. Please install GCC to build the server."
    exit 1
fi

# Compile the server
echo "Compiling server.c..."
gcc server.c -o gramcare

# Remove any stale database so a new user starts fresh
rm -f gramcare.db

# Start the server in the background
echo "Starting server on http://localhost:8080..."
./gramcare &
SERVER_PID=$!

# Wait for server to be ready
sleep 1

# Open the browser
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:8080
elif command -v open &> /dev/null; then
    open http://localhost:8080
else
    echo "Open your browser to: http://localhost:8080"
fi

echo ""
echo "Server is running (PID: $SERVER_PID)."
echo "Press Ctrl+C to stop the server."
wait $SERVER_PID
