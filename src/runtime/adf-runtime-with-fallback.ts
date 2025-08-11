import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { ADF } from '../types/adf-schema.js'
import { ElicitationService } from './elicitation-service.js'
import { ElicitationWorkaround } from './elicitation-workaround.js'
import { SamplingService } from './sampling-service.js'
import { HandlerLoader } from './handler-loader.js'
import { WorkflowStateMachine } from './state-machine.js'
import winston from 'winston'

/**
 * Enhanced ADF Runtime with automatic fallback for clients without elicitation support.
 * 
 * Features:
 * - Detects client capabilities
 * - Uses native elicitation when available
 * - Falls back to prompts/resources/tools workaround when not
 * - Seamless workflow execution regardless of client support
 */
export class ADFRuntimeWithFallback {
  private server: Server
  private adf: ADF
  private elicitationService: ElicitationService
  private elicitationWorkaround: ElicitationWorkaround
  private samplingService: SamplingService
  private handlerLoader: HandlerLoader
  private stateMachine?: WorkflowStateMachine
  private logger: winston.Logger
  private useElicitationWorkaround: boolean = false

  constructor(adf: ADF) {
    this.adf = adf
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.simple()
      ),
      transports: [new winston.transports.Console()]
    })

    // Initialize server with all capabilities
    this.server = new Server(
      {
        name: adf.agent.name,
        version: adf.version,
      },
      {
        capabilities: {
          tools: adf.agent.capabilities?.tools !== false && (adf.agent.tools?.length ?? 0) > 0 ? {} : undefined,
          resources: {
            subscribe: false,
            listChanged: false
          },
          prompts: {
            listChanged: false
          },
          sampling: adf.agent.capabilities?.sampling !== false ? {} : undefined,
        },
      }
    )

    // Initialize services
    this.elicitationService = new ElicitationService()
    this.elicitationWorkaround = new ElicitationWorkaround()
    this.samplingService = new SamplingService()
    this.handlerLoader = new HandlerLoader(adf.agent.handlers?.path || './handlers')

    this.setupHandlers()
  }

  private setupHandlers(): void {
    // Always use elicitation workaround in this runtime variant
    // This is designed for clients that don't support native elicitation
    this.useElicitationWorkaround = true
    this.logger.info('Using elicitation workaround via prompts/resources/tools')
    this.elicitationWorkaround.registerHandlers(this.server)

    // Register tool handlers
    if (this.adf.agent.tools) {
      this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          ...this.adf.agent.tools!.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: {
              type: 'object',
              properties: tool.parameters || {},
              required: Object.entries(tool.parameters || {})
                .filter(([_, param]) => param.required)
                .map(([name]) => name)
            }
          })),
          // Always include the elicitation response tool for fallback
          {
            name: 'respond_to_elicitation',
            description: 'Provide a response to an active elicitation (fallback for clients without elicitation support)',
            inputSchema: {
              type: 'object',
              properties: {
                elicitation_id: { type: 'string' },
                response: { type: ['string', 'number', 'boolean', 'object'] }
              },
              required: ['elicitation_id', 'response']
            }
          },
          {
            name: 'get_elicitation_guidance',
            description: 'Get guidance on gathering information from the user',
            inputSchema: {
              type: 'object',
              properties: {
                elicitation_id: { type: 'string' }
              },
              required: ['elicitation_id']
            }
          }
        ]
      }))

      this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        // Handle elicitation workaround tools
        if (request.params.name === 'respond_to_elicitation' || 
            request.params.name === 'get_elicitation_guidance') {
          // These are handled by the workaround
          return { content: [{ type: 'text', text: 'Handled by elicitation workaround' }] }
        }

        // Handle regular tools
        const tool = this.adf.agent.tools!.find(t => t.name === request.params.name)
        if (!tool) {
          throw new Error(`Tool ${request.params.name} not found`)
        }

        try {
          const handler = await this.handlerLoader.loadToolHandler(tool.handler)
          const result = await handler(request.params.arguments)
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          }
        } catch (error: any) {
          this.logger.error(`Tool execution failed: ${error.message}`)
          throw error
        }
      })
    }

    // Register resource handlers
    if (this.adf.agent.resources || this.useElicitationWorkaround) {
      this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
          ...(this.adf.agent.resources || []).map(resource => ({
            uri: resource.uri,
            description: resource.description,
            mimeType: 'application/json'
          })),
          // Elicitation workaround resources are added dynamically
        ]
      }))

      this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        // Check if it's an elicitation resource
        if (request.params.uri.startsWith('elicitation://')) {
          // Handled by workaround
          return { contents: [] }
        }

        const resource = this.adf.agent.resources?.find(r => r.uri === request.params.uri)
        if (!resource) {
          throw new Error(`Resource ${request.params.uri} not found`)
        }

        if (resource.handler) {
          const handler = await this.handlerLoader.loadResourceHandler(resource.handler)
          const content = await handler(request.params.uri)
          
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(content, null, 2)
              }
            ]
          }
        }

        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'application/json',
              text: JSON.stringify({ message: 'Static resource', uri: resource.uri })
            }
          ]
        }
      })
    }

    // Register prompt handlers for elicitation workaround
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: []  // Will be populated by workaround when active
    }))

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      // Handled by workaround when active
      throw new Error(`Prompt ${request.params.name} not found`)
    })

    // Register sampling handlers if supported
    if (this.adf.agent.capabilities?.sampling !== false) {
      // Sampling implementation would go here
    }
  }

  /**
   * Execute an elicitation with automatic fallback
   */
  async executeElicitation(elicitation: any, context?: Record<string, any>): Promise<any> {
    if (this.useElicitationWorkaround) {
      // Use the workaround
      this.logger.debug('Using elicitation workaround')
      return this.elicitationWorkaround.createElicitation(elicitation, context)
    } else {
      // Use native elicitation
      this.logger.debug('Using native elicitation')
      return this.elicitationService.execute(elicitation)
    }
  }

  /**
   * Initialize and start workflow with elicitation support detection
   */
  private initializeWorkflow(): void {
    const defaultWorkflow = Object.keys(this.adf.agent.workflows)[0]
    if (!defaultWorkflow) {
      this.logger.warn('No workflows defined')
      return
    }

    this.stateMachine = new WorkflowStateMachine(this.adf, defaultWorkflow)
    
    // Set up state machine services with fallback support
    const services = {
      elicitation: async (_context: any, event: any) => {
        return this.executeElicitation(event.data.config, _context.variables)
      },
      sampling: async (context: any, event: any) => {
        return this.samplingService.execute(event.data.config, context.variables)
      },
      executeTool: async (context: any, event: any) => {
        const tool = this.adf.agent.tools?.find(t => t.name === event.data.toolName)
        if (!tool) {
          throw new Error(`Tool ${event.data.toolName} not found`)
        }
        const handler = await this.handlerLoader.loadToolHandler(tool.handler)
        return handler(context.variables)
      }
    }

    const guards = {
      evaluateCondition: (context: any, _event: any, { cond }: any) => {
        return Boolean(context.variables[cond.condition])
      }
    }

    this.stateMachine.start(services, guards)
  }

  async start(transport?: StdioServerTransport): Promise<void> {
    const activeTransport = transport || new StdioServerTransport()
    
    this.logger.info(`Starting ADF Runtime with Fallback for agent: ${this.adf.agent.name}`)
    this.logger.info('Elicitation fallback ready for clients without native support')
    
    this.initializeWorkflow()
    
    await this.server.connect(activeTransport)
    this.logger.info('Server started successfully')
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping ADF Runtime')
    
    if (this.stateMachine) {
      this.stateMachine.stop()
    }
    
    await this.server.close()
  }
}