#!/bin/bash
# Simple web server launcher for Stock Analysis App
# This avoids the Python xcode-select issue

echo "🚀 Starting Stock Analysis App Server..."
echo ""

# Check if we can use Ruby (usually pre-installed on macOS)
if command -v ruby &> /dev/null; then
    echo "✅ Using Ruby web server"
    echo "📊 Open your browser to: http://localhost:8000"
    echo ""
    echo "Press Ctrl+C to stop the server"
    echo ""
    ruby -run -e httpd . -p 8000
else
    echo "❌ No suitable web server found"
    echo ""
    echo "Please install Xcode Command Line Tools:"
    echo "  xcode-select --install"
    echo ""
    echo "Or use a browser extension to disable CORS temporarily"
fi
