#!/bin/bash

echo "🚀 Agent Definition Format (ADF) Demo"
echo "====================================="
echo ""

# Build the project
echo "📦 Building project..."
npm run build

echo ""
echo "✅ Validating example ADF files..."
echo ""

# Validate examples
echo "1. Customer Support Agent:"
node dist/cli.js validate examples/customer-support.yaml

echo ""
echo "2. Simple Q&A Agent:"
node dist/cli.js validate examples/simple-qa.yaml

echo ""
echo "📝 Creating a new agent from template..."
node dist/cli.js init demo-agent --type workflow

echo ""
echo "📂 Generated file:"
cat demo-agent.yaml

echo ""
echo "🧪 Running tests..."
npm test

echo ""
echo "✨ Demo complete!"
echo ""
echo "To run an agent as an MCP server:"
echo "  node dist/cli.js run examples/customer-support.yaml"
echo ""
echo "To use with Claude Desktop, add to config:"
echo '  "adf-agent": {'
echo '    "command": "node",'
echo '    "args": ["'$(pwd)'/dist/cli.js", "run", "your-agent.yaml"]'
echo '  }'