# Elicitation Fallback Strategy

## Overview

The ADF framework now includes an automatic fallback mechanism for MCP clients that don't support native elicitation. This ensures your agents can gather user input regardless of client capabilities.

## How It Works

### Detection
When a client connects, the runtime automatically detects whether it supports elicitation:
- **With elicitation support**: Uses native MCP elicitation protocol
- **Without elicitation support**: Automatically falls back to workaround using prompts, resources, and tools

### Fallback Mechanism

The fallback uses three MCP features that are universally supported:

1. **Prompts** - Exposes elicitations as prompts with embedded instructions
2. **Resources** - Provides conversation history and current elicitation state
3. **Tools** - Offers tools for agents to submit validated responses

## Architecture

```
┌─────────────────┐
│   MCP Client    │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Detects │
    │Support? │
    └────┬────┘
         │
    ┌────▼────────────────┐
    │                      │
    ▼                      ▼
┌──────────┐      ┌──────────────┐
│ Native   │      │  Workaround  │
│Elicitation│     │   Fallback   │
└──────────┘      └──────────────┘
                          │
                  ┌───────┼───────┐
                  ▼       ▼       ▼
              Prompts Resources Tools
```

## For Agents Without Elicitation Support

When working with a client that doesn't support elicitation (like Claude), the agent receives:

### 1. Guidance Tool
```typescript
{
  name: 'get_elicitation_guidance',
  description: 'Get guidance on gathering information from the user'
}
```

This provides instructions on:
- What information to gather
- How to ask the user
- Validation requirements
- How to submit the response

### 2. Response Tool
```typescript
{
  name: 'respond_to_elicitation',
  description: 'Submit user response to elicitation'
}
```

Used to submit validated responses back to the workflow.

### 3. Embedded Resources
- `elicitation://history` - Complete conversation history
- `elicitation://current/{id}` - Current elicitation details with validation rules

## Example Workflow

### Agent Interaction (Without Native Support)

1. **Workflow triggers elicitation**
   ```yaml
   get_name:
     type: "elicitation"
     elicitation:
       type: "text"
       prompt: "What's your name?"
       pattern: "^[A-Za-z ]+$"
   ```

2. **Agent receives guidance**
   ```typescript
   // Agent calls get_elicitation_guidance
   {
     instructions: "Ask the user for their name",
     validation: "Must contain only letters and spaces",
     example: "Agent: 'What's your name?'"
   }
   ```

3. **Agent asks user naturally**
   ```
   Agent: "I need to set up your profile. What's your name?"
   User: "Alice Smith"
   ```

4. **Agent submits response**
   ```typescript
   // Agent calls respond_to_elicitation
   {
     elicitation_id: "elicit-123",
     response: "Alice Smith"
   }
   ```

5. **Workflow continues**
   The response is validated and the workflow proceeds to the next state.

## Implementation Example

### Simple Text Elicitation
```yaml
states:
  get_email:
    type: "elicitation"
    prompt: "Please provide your email address"
    elicitation:
      type: "text"
      prompt: "Enter your email"
      pattern: "^[\\w.]+@[\\w.]+\\.[a-z]+$"
      required: true
```

**With native support**: Direct elicitation UI
**Without support**: Agent conversation
```
Agent: "Please provide your email address. It should be in the format user@example.com"
User: "alice@example.com"
Agent: [validates and submits via tool]
```

### Selection Elicitation
```yaml
states:
  choose_plan:
    type: "elicitation"
    elicitation:
      type: "select"
      prompt: "Choose your subscription plan"
      options: ["Basic", "Pro", "Enterprise"]
```

**With native support**: Dropdown/radio buttons
**Without support**: Agent conversation
```
Agent: "Which subscription plan would you like?
        1. Basic
        2. Pro  
        3. Enterprise"
User: "I'll take Pro"
Agent: [submits "Pro" via tool]
```

### Confirmation Elicitation
```yaml
states:
  confirm_purchase:
    type: "elicitation"
    elicitation:
      type: "confirm"
      prompt: "Confirm purchase of {item} for {price}?"
```

**With native support**: Yes/No buttons
**Without support**: Agent conversation
```
Agent: "Would you like to confirm your purchase of Premium Plan for $9.99/month?"
User: "Yes, go ahead"
Agent: [submits true via tool]
```

## Benefits

1. **Universal Compatibility** - Works with any MCP client
2. **Natural Conversations** - Agents handle elicitation conversationally
3. **Consistent Validation** - Same validation rules regardless of method
4. **Transparent Fallback** - Automatic detection and switching
5. **No Code Changes** - Existing ADF definitions work as-is

## Testing

To test the fallback mechanism:

1. **Force fallback mode**:
   ```typescript
   const runtime = new ADFRuntimeWithFallback(adf)
   runtime.useElicitationWorkaround = true // Force fallback
   ```

2. **Run with different clients**:
   - Clients with elicitation: Native UI
   - Clients without (like Claude): Conversational fallback

3. **Verify conversation flow**:
   ```typescript
   // Check that prompts are exposed
   const prompts = await client.listPrompts()
   
   // Check resources are available
   const resources = await client.listResources()
   
   // Verify tools work
   const tools = await client.listTools()
   ```

## Best Practices

1. **Write clear prompts** - They'll be shown to users directly or through agents
2. **Include validation hints** - Help agents guide users
3. **Provide examples** - Makes agent interactions more natural
4. **Test both modes** - Ensure workflows work with and without native support
5. **Monitor logs** - Runtime logs which mode is active

## Configuration

```typescript
// Automatic detection (recommended)
const runtime = new ADFRuntimeWithFallback(adf)

// Force specific mode
runtime.useElicitationWorkaround = true  // Force fallback
runtime.useElicitationWorkaround = false // Force native

// Custom timeout for fallback
process.env.ELICITATION_TIMEOUT = '600000' // 10 minutes
```

## Troubleshooting

### Issue: Agent not receiving guidance
**Solution**: Check that the client is calling `get_elicitation_guidance` tool

### Issue: Validation failures
**Solution**: Verify regex patterns are properly escaped in YAML

### Issue: Timeout errors
**Solution**: Increase timeout or ensure agent responds promptly

### Issue: Context variables not replaced
**Solution**: Ensure context is passed to elicitation creation

## Future Enhancements

- [ ] Persistent elicitation state across sessions
- [ ] Multi-step elicitation workflows
- [ ] Rich media support (images, files)
- [ ] Batch elicitation for multiple inputs
- [ ] Custom validation functions