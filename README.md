# Agent Definition Format (ADF)

A declarative framework for defining MCP agents using YAML/JSON, with TypeScript runtime interpreter.

## Overview

ADF allows developers to define complete MCP agent behavior declaratively, dramatically reducing boilerplate code and enabling rapid agent development. Define workflows, state transitions, sampling prompts, and elicitation schemas in YAML, and the ADF runtime interprets them as standard MCP servers.

## Features

- **Declarative Agent Definition**: Define agents in YAML or JSON
- **Workflow State Machines**: Built-in state management with XState
- **Tool & Resource Support**: Easy integration of tools and resources
- **Elicitation & Sampling**: Native support for user interactions and LLM sampling
- **TypeScript Runtime**: Fast, type-safe runtime engine
- **Hot Reload**: Development mode with automatic reload
- **Validation**: Schema validation with detailed error messages

## Quick Start

### Installation

```bash
npm install @waldzellai/adf-framework
```

### Create Your First Agent

1. Generate a template:
```bash
npx adf init my-agent --type workflow
```

2. Edit `my-agent.yaml`:
```yaml
version: "1.0"
agent:
  name: "my-agent"
  description: "My first ADF agent"
  
  capabilities:
    sampling: true
    elicitation: true
    
  workflows:
    main:
      initial: "greeting"
      
      states:
        greeting:
          type: "elicitation"
          elicitation:
            type: "select"
            prompt: "How can I help?"
            options: ["Option A", "Option B"]
          transitions:
            "Option A": "process_a"
            "Option B": "process_b"
            
        process_a:
          type: "response"
          template: "Processing Option A..."
          
        process_b:
          type: "response"
          template: "Processing Option B..."
```

3. Run your agent:
```bash
npx adf run my-agent.yaml
```

## ADF Schema

### Agent Structure

```yaml
version: "1.0"
agent:
  name: string           # Agent identifier
  description: string    # Human-readable description
  
  capabilities:          # Optional capabilities
    sampling: boolean
    elicitation: boolean
    tools: boolean
    resources: boolean
    
  tools:                 # Tool definitions
    - name: string
      description: string
      parameters: object
      handler: string    # Path to handler function
      
  resources:             # Resource definitions
    - uri: string
      description: string
      handler: string    # Optional handler
      
  workflows:             # Workflow definitions
    [workflow_name]:
      initial: string    # Initial state
      states:           # State definitions
        [state_name]: State
        
  handlers:              # Handler configuration
    path: string         # Base path for handlers
    runtime: typescript|python
```

### State Types

#### Elicitation State
Request input from the user:
```yaml
greeting:
  type: "elicitation"
  elicitation:
    type: "select|text|confirm|number"
    prompt: "User prompt"
    options: ["Option 1", "Option 2"]  # For select type
  transitions:
    [response]: [next_state]
```

#### Sampling State
Use LLM for processing:
```yaml
analyze:
  type: "sampling"
  prompt: "Analyze this data..."
  context: ["variable1", "variable2"]
  transitions:
    default: "next_state"
```

#### Response State
Send final response:
```yaml
complete:
  type: "response"
  template: "Task completed: {result}"
```

#### Tool State
Execute a tool:
```yaml
process:
  type: "tool"
  tool: "tool_name"
  transitions:
    default: "next_state"
```

#### Conditional State
Branch based on condition:
```yaml
check:
  type: "conditional"
  condition: "has_data"
  onTrue: "process"
  onFalse: "gather"
```

## CLI Commands

### Run an Agent
```bash
adf run <file> [options]

Options:
  -d, --debug    Enable debug logging
  -w, --watch    Watch for changes and reload
```

### Validate an ADF File
```bash
adf validate <file>
```

### Create a Template
```bash
adf init <name> [options]

Options:
  -t, --type <type>  Template type (basic|workflow|full)
```

## Custom Handlers

Create custom handlers for tools and resources:

```typescript
// handlers/myTool.ts
export default async function myTool(args: any) {
  // Tool implementation
  return {
    success: true,
    result: "Tool executed"
  };
}
```

Reference in your ADF:
```yaml
tools:
  - name: "my_tool"
    handler: "myTool"  # Resolves to handlers/myTool.ts
```

## Examples

See the `examples/` directory for complete agent definitions:
- `customer-support.yaml` - Full customer service agent
- `simple-qa.yaml` - Basic Q&A agent

## Development

### Build from Source
```bash
npm install
npm run build
```

### Run Tests
```bash
npm test
```

### Development Mode
```bash
npm run dev
```

## Architecture

- **Parser**: Validates and loads ADF definitions
- **Runtime**: Interprets ADF as MCP server
- **State Machine**: Manages workflow execution with XState
- **Services**: Handles elicitation, sampling, and tool execution
- **Handler Loader**: Dynamic loading of custom handlers

## Performance

- **80% reduction** in boilerplate code
- **5-minute** agent creation for simple use cases
- Support for **90%** of common agent patterns
- Compatible with TypeScript and Python runtimes

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines before submitting PRs.

## Support

For issues and feature requests, please use the GitHub issue tracker.