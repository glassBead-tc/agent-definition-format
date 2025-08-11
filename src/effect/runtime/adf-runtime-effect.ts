import { Effect, Layer, pipe, Schedule, Duration } from "effect"
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { ADF } from '../../types/adf-schema.js'
import { LoggerService, LoggerServiceLive } from '../services/logger.service.js'
import { ConfigService, makeConfigService } from '../services/config.service.js'
import { HandlerLoaderService, HandlerLoaderServiceLive } from '../services/handler-loader.service.js'
import { 
  ToolExecutionError, 
  ResourceNotFoundError,
  TimeoutError 
} from '../errors/domain.errors.js'
import { runEffectAsPromise } from '../compatibility/bridge.js'

export class ADFRuntimeEffect {
  private server: Server
  private adf: ADF
  private runtime: Layer.Layer<LoggerService | ConfigService | HandlerLoaderService>

  constructor(adf: ADF) {
    this.adf = adf
    this.server = new Server(
      {
        name: adf.agent.name,
        version: adf.version,
      },
      {
        capabilities: {
          tools: adf.agent.capabilities?.tools !== false && (adf.agent.tools?.length ?? 0) > 0 ? {} : undefined,
          resources: adf.agent.capabilities?.resources !== false && (adf.agent.resources?.length ?? 0) > 0 ? {} : undefined,
        },
      }
    )

    // Compose all service layers
    const loggerLayer = LoggerServiceLive
    const configLayer = makeConfigService(adf)
    const handlerLoaderLayer = HandlerLoaderServiceLive.pipe(
      Layer.provide(loggerLayer),
      Layer.provide(configLayer)
    )
    
    this.runtime = Layer.mergeAll(
      loggerLayer,
      configLayer,
      handlerLoaderLayer
    )

    this.setupHandlers()
  }

  private setupHandlers(): void {
    // Tools handler with Effect
    if (this.adf.agent.tools) {
      this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: this.adf.agent.tools!.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: 'object',
            properties: tool.parameters || {},
            required: Object.entries(tool.parameters || {})
              .filter(([_, param]) => param.required)
              .map(([name]) => name)
          }
        }))
      }))

      this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = this.adf.agent.tools!.find(t => t.name === request.params.name)
        if (!tool) {
          throw new Error(`Tool ${request.params.name} not found`)
        }

        // Execute tool with Effect
        const effect = Effect.gen(function* () {
          const logger = yield* LoggerService
          const loader = yield* HandlerLoaderService
          const config = yield* ConfigService
          const timeout = yield* config.getTimeout()
          
          yield* logger.info(`Executing tool: ${tool.name}`)
          
          // Load and execute handler with timeout and retry
          const handler = yield* loader.loadToolHandler(tool.handler)
          
          // Handle both Promise and Effect returns
          const handlerResult = handler(request.params.arguments)
          const effectResult = Effect.isEffect(handlerResult) 
            ? handlerResult
            : Effect.tryPromise({
                try: async () => handlerResult,
                catch: (error) => new ToolExecutionError({
                  toolName: tool.name,
                  args: request.params.arguments,
                  cause: error
                })
              })
          
          const executeWithRetry = pipe(
            effectResult,
            Effect.timeout(Duration.millis(timeout)),
            Effect.retry(
              Schedule.exponential(Duration.seconds(1), 2).pipe(
                Schedule.compose(Schedule.recurs(2))
              )
            ),
            Effect.catchTag("TimeoutException", () => 
              Effect.fail(new TimeoutError({
                operation: `Tool ${tool.name}`,
                timeoutMs: timeout
              }))
            )
          )
          
          const result = yield* executeWithRetry
          yield* logger.info(`Tool ${tool.name} executed successfully`)
          
          return result
        }).pipe(Effect.provide(this.runtime))

        // Run Effect and convert to Promise
        const result = await runEffectAsPromise(effect)
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
      })
    }

    // Resources handler with Effect
    if (this.adf.agent.resources) {
      this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: this.adf.agent.resources!.map(resource => ({
          uri: resource.uri,
          description: resource.description,
          mimeType: 'application/json'
        }))
      }))

      this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const resource = this.adf.agent.resources!.find(r => r.uri === request.params.uri)
        if (!resource) {
          throw new Error(`Resource ${request.params.uri} not found`)
        }

        const effect = Effect.gen(function* () {
          const logger = yield* LoggerService
          const loader = yield* HandlerLoaderService
          
          yield* logger.info(`Reading resource: ${resource.uri}`)
          
          if (resource.handler) {
            const handler = yield* loader.loadResourceHandler(resource.handler)
            const handlerResult = handler(request.params.uri)
            const content = yield* (Effect.isEffect(handlerResult)
              ? handlerResult
              : Effect.tryPromise({
                  try: async () => handlerResult,
                  catch: () => new ResourceNotFoundError({ uri: request.params.uri })
                }))
            
            return content
          }
          
          return { message: 'Static resource', uri: resource.uri }
        }).pipe(Effect.provide(this.runtime))

        const content = await runEffectAsPromise(effect)
        
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'application/json',
              text: JSON.stringify(content, null, 2)
            }
          ]
        }
      })
    }
  }

  async start(transport?: StdioServerTransport): Promise<void> {
    const activeTransport = transport || new StdioServerTransport()
    const adfName = this.adf.agent.name
    
    const startEffect = Effect.gen(function* () {
      const logger = yield* LoggerService
      yield* logger.info(`Starting ADF Runtime (Effect) for agent: ${adfName}`)
      yield* logger.info(`Effect-TS integration active`)
    }).pipe(Effect.provide(this.runtime))
    
    await runEffectAsPromise(startEffect)
    await this.server.connect(activeTransport)
  }

  async stop(): Promise<void> {
    const stopEffect = Effect.gen(function* () {
      const logger = yield* LoggerService
      yield* logger.info('Stopping ADF Runtime (Effect)')
    }).pipe(Effect.provide(this.runtime))
    
    await runEffectAsPromise(stopEffect)
    await this.server.close()
  }
}