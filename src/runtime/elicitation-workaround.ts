import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import type { Elicitation } from '../types/adf-schema.js'

/**
 * ElicitationWorkaround provides fallback mechanisms for clients that don't support
 * native elicitation by using MCP prompts, resources, and tools.
 * 
 * Strategy:
 * 1. Expose elicitations as prompts with embedded resources
 * 2. Create tools that can process user responses
 * 3. Maintain conversation state through resources
 */
export class ElicitationWorkaround {
  private pendingElicitations = new Map<string, {
    elicitation: Elicitation
    resolve: (value: any) => void
    reject: (error: any) => void
    context?: Record<string, any>
  }>()
  
  private conversationHistory: Array<{
    id: string
    type: string
    prompt: string
    response?: any
    timestamp: number
  }> = []

  /**
   * Register MCP handlers for prompts, resources, and tools
   */
  registerHandlers(server: Server): void {
    // Register prompt handlers
    this.registerPromptHandlers(server)
    
    // Register resource handlers  
    this.registerResourceHandlers(server)
    
    // Register tool handlers
    this.registerToolHandlers(server)
  }

  private registerPromptHandlers(server: Server): void {
    // List available elicitation prompts
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: Array.from(this.pendingElicitations.entries()).map(([id, pending]) => ({
        name: `elicitation_${id}`,
        description: this.getElicitationDescription(pending.elicitation),
        arguments: [
          {
            name: 'user_response',
            description: 'Your response to the question',
            required: true
          }
        ]
      }))
    }))

    // Get specific elicitation prompt with embedded resources
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const id = request.params.name.replace('elicitation_', '')
      const pending = this.pendingElicitations.get(id)
      
      if (!pending) {
        throw new Error(`Elicitation ${id} not found`)
      }

      return {
        description: this.getElicitationDescription(pending.elicitation),
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: this.formatElicitationPrompt(pending.elicitation, pending.context)
            }
          },
          {
            role: 'assistant',
            content: {
              type: 'resource',
              resource: {
                uri: `elicitation://current/${id}`,
                mimeType: 'application/json',
                text: JSON.stringify({
                  elicitation: pending.elicitation,
                  context: pending.context,
                  instructions: this.getElicitationInstructions(pending.elicitation)
                }, null, 2)
              }
            }
          }
        ]
      }
    })
  }

  private registerResourceHandlers(server: Server): void {
    // List elicitation resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'elicitation://history',
          name: 'Conversation History',
          description: 'Complete history of elicitation interactions',
          mimeType: 'application/json'
        },
        ...Array.from(this.pendingElicitations.keys()).map(id => ({
          uri: `elicitation://current/${id}`,
          name: `Current Elicitation ${id}`,
          description: 'Active elicitation waiting for response',
          mimeType: 'application/json'
        }))
      ]
    }))

    // Read elicitation resources
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params
      
      if (uri === 'elicitation://history') {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.conversationHistory, null, 2)
          }]
        }
      }
      
      if (uri.startsWith('elicitation://current/')) {
        const id = uri.replace('elicitation://current/', '')
        const pending = this.pendingElicitations.get(id)
        
        if (!pending) {
          throw new Error(`Elicitation ${id} not found`)
        }
        
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              id,
              elicitation: pending.elicitation,
              context: pending.context,
              instructions: this.getElicitationInstructions(pending.elicitation),
              validationRules: this.getValidationRules(pending.elicitation)
            }, null, 2)
          }]
        }
      }
      
      throw new Error(`Unknown resource: ${uri}`)
    })
  }

  private registerToolHandlers(server: Server): void {
    // Define tools array
    const tools = [
      {
        name: 'respond_to_elicitation',
        description: 'Provide a response to an active elicitation',
        inputSchema: {
          type: 'object',
          properties: {
            elicitation_id: {
              type: 'string',
              description: 'The ID of the elicitation to respond to'
            },
            response: {
              type: ['string', 'number', 'boolean', 'object'],
              description: 'Your response to the elicitation'
            }
          },
          required: ['elicitation_id', 'response']
        }
      },
      {
        name: 'get_elicitation_guidance',
        description: 'Get guidance on how to gather information from the user for an elicitation',
        inputSchema: {
          type: 'object',
          properties: {
            elicitation_id: {
              type: 'string',
              description: 'The ID of the elicitation'
            }
          },
          required: ['elicitation_id']
        }
      }
    ]
    
    // Register list tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
    
    // Register call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      
      if (name === 'respond_to_elicitation') {
        const { elicitation_id, response } = args as any
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await this.handleResponse(elicitation_id, response))
            }
          ]
        }
      }
      
      if (name === 'get_elicitation_guidance') {
        const { elicitation_id } = args as any
        const pending = this.pendingElicitations.get(elicitation_id)
        
        if (!pending) {
          throw new Error(`Elicitation ${elicitation_id} not found`)
        }
        
        return {
          content: [
            {
              type: 'text',
              text: this.getAgentInstructions(pending.elicitation, pending.context)
            },
            {
              type: 'resource',
              resource: {
                uri: `elicitation://current/${elicitation_id}`,
              mimeType: 'application/json'
            }
          }
        ]
        }
      }
      
      throw new Error(`Unknown tool: ${name}`)
    })
  }

  /**
   * Create a new elicitation that works through prompts/tools
   */
  async createElicitation(
    elicitation: Elicitation,
    context?: Record<string, any>
  ): Promise<any> {
    const id = `elicit-${Date.now()}-${Math.random().toString(36).substring(7)}`
    
    return new Promise((resolve, reject) => {
      this.pendingElicitations.set(id, {
        elicitation,
        resolve,
        reject,
        context
      })
      
      // Add to conversation history
      this.conversationHistory.push({
        id,
        type: elicitation.type,
        prompt: elicitation.prompt,
        timestamp: Date.now()
      })
      
      // Set a timeout for the elicitation
      setTimeout(() => {
        if (this.pendingElicitations.has(id)) {
          this.pendingElicitations.delete(id)
          reject(new Error('Elicitation timeout'))
        }
      }, 300000) // 5 minute timeout
    })
  }

  private handleResponse(id: string, response: any): any {
    const pending = this.pendingElicitations.get(id)
    
    if (!pending) {
      throw new Error(`Elicitation ${id} not found`)
    }
    
    // Validate the response
    const validation = this.validateResponse(response, pending.elicitation)
    
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid response: ${validation.error}\n\n${this.getElicitationInstructions(pending.elicitation)}`
          }
        ]
      }
    }
    
    // Transform the response
    const transformedResponse = this.transformResponse(response, pending.elicitation)
    
    // Update history
    const historyEntry = this.conversationHistory.find(h => h.id === id)
    if (historyEntry) {
      historyEntry.response = transformedResponse
    }
    
    // Resolve the promise
    pending.resolve(transformedResponse)
    this.pendingElicitations.delete(id)
    
    return {
      content: [
        {
          type: 'text',
          text: `Response accepted: ${JSON.stringify(transformedResponse)}`
        }
      ]
    }
  }

  private formatElicitationPrompt(
    elicitation: Elicitation,
    context?: Record<string, any>
  ): string {
    let prompt = elicitation.prompt
    
    // Replace context variables
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), String(value))
      })
    }
    
    // Add type-specific formatting
    switch (elicitation.type) {
      case 'select':
        if (elicitation.options) {
          prompt += '\n\nOptions:\n' + elicitation.options
            .map((opt, i) => `${i + 1}. ${opt}`)
            .join('\n')
        }
        break
        
      case 'confirm':
        prompt += '\n\n(Please respond with yes/no)'
        break
        
      case 'number':
        if (elicitation.min !== undefined || elicitation.max !== undefined) {
          const constraints = []
          if (elicitation.min !== undefined) constraints.push(`minimum: ${elicitation.min}`)
          if (elicitation.max !== undefined) constraints.push(`maximum: ${elicitation.max}`)
          prompt += `\n\n(Constraints: ${constraints.join(', ')})`
        }
        break
        
      case 'text':
        if (elicitation.pattern) {
          prompt += `\n\n(Format: must match pattern /${elicitation.pattern}/)`
        }
        break
    }
    
    return prompt
  }

  private getElicitationDescription(elicitation: Elicitation): string {
    return `${elicitation.type} elicitation: ${elicitation.prompt.substring(0, 50)}...`
  }

  private getElicitationInstructions(elicitation: Elicitation): string {
    const instructions = [`Please provide a ${elicitation.type} response.`]
    
    switch (elicitation.type) {
      case 'select':
        instructions.push(`Choose one of the following options: ${elicitation.options?.join(', ')}`)
        break
      case 'confirm':
        instructions.push('Respond with "yes" or "no"')
        break
      case 'number':
        if (elicitation.min !== undefined) instructions.push(`Minimum value: ${elicitation.min}`)
        if (elicitation.max !== undefined) instructions.push(`Maximum value: ${elicitation.max}`)
        break
      case 'text':
        if (elicitation.pattern) instructions.push(`Must match pattern: ${elicitation.pattern}`)
        break
    }
    
    if (elicitation.required !== false) {
      instructions.push('This response is required.')
    }
    
    return instructions.join('\n')
  }

  private getAgentInstructions(elicitation: Elicitation, context?: Record<string, any>): string {
    const prompt = this.formatElicitationPrompt(elicitation, context)
    
    return `
# Elicitation Request

You need to gather the following information from the user:

${prompt}

## Instructions for the Agent:

1. Ask the user the question above in a natural, conversational way
2. Validate their response according to the type: ${elicitation.type}
${this.getValidationRules(elicitation).map(rule => `   - ${rule}`).join('\n')}
3. Once you have a valid response, use the 'respond_to_elicitation' tool to submit it
4. If the response is invalid, help the user understand what's needed

## Example Interaction:

Agent: "${prompt}"
User: [provides response]
Agent: [validates and submits via tool, or asks for clarification]

Remember: The goal is to get valid input from the user that matches the elicitation requirements.
`
  }

  private getValidationRules(elicitation: Elicitation): string[] {
    const rules: string[] = []
    
    switch (elicitation.type) {
      case 'select':
        rules.push(`Must be one of: ${elicitation.options?.join(', ')}`)
        break
      case 'confirm':
        rules.push('Must be yes/no or equivalent (y/n, true/false)')
        break
      case 'number':
        rules.push('Must be a valid number')
        if (elicitation.min !== undefined) rules.push(`Must be >= ${elicitation.min}`)
        if (elicitation.max !== undefined) rules.push(`Must be <= ${elicitation.max}`)
        break
      case 'text':
        rules.push('Must be a text string')
        if (elicitation.pattern) rules.push(`Must match pattern: /${elicitation.pattern}/`)
        break
    }
    
    return rules
  }

  private validateResponse(response: any, elicitation: Elicitation): { valid: boolean; error?: string } {
    switch (elicitation.type) {
      case 'text':
        if (typeof response !== 'string') {
          return { valid: false, error: 'Response must be a string' }
        }
        if (elicitation.pattern) {
          const regex = new RegExp(elicitation.pattern)
          if (!regex.test(response)) {
            return { valid: false, error: `Response does not match pattern: ${elicitation.pattern}` }
          }
        }
        break
        
      case 'number':
        const num = Number(response)
        if (isNaN(num)) {
          return { valid: false, error: 'Response must be a number' }
        }
        if (elicitation.min !== undefined && num < elicitation.min) {
          return { valid: false, error: `Response must be >= ${elicitation.min}` }
        }
        if (elicitation.max !== undefined && num > elicitation.max) {
          return { valid: false, error: `Response must be <= ${elicitation.max}` }
        }
        break
        
      case 'confirm':
        const normalizedResponse = String(response).toLowerCase()
        if (!['yes', 'no', 'y', 'n', 'true', 'false'].includes(normalizedResponse)) {
          return { valid: false, error: 'Response must be yes/no' }
        }
        break
        
      case 'select':
        if (!elicitation.options?.includes(String(response))) {
          // Also check if response is a valid index
          const index = Number(response) - 1
          if (isNaN(index) || index < 0 || index >= (elicitation.options?.length || 0)) {
            return { valid: false, error: `Response must be one of: ${elicitation.options?.join(', ')}` }
          }
        }
        break
    }
    
    return { valid: true }
  }

  private transformResponse(response: any, elicitation: Elicitation): any {
    switch (elicitation.type) {
      case 'number':
        return Number(response)
        
      case 'confirm':
        const normalized = String(response).toLowerCase()
        return normalized === 'yes' || normalized === 'y' || normalized === 'true'
        
      case 'select':
        // Handle both option value and index
        const index = Number(response) - 1
        if (!isNaN(index) && elicitation.options && index >= 0 && index < elicitation.options.length) {
          return elicitation.options[index]
        }
        return response
        
      default:
        return response
    }
  }
}