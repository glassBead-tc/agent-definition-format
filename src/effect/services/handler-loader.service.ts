import { Context, Effect, Layer, Cache, Duration } from "effect"
import path from 'path'
import { pathToFileURL } from 'url'
import { LoggerService } from './logger.service.js'
import { ConfigService } from './config.service.js'
import { HandlerNotFoundError } from '../errors/domain.errors.js'

export type ToolHandler = (args: any) => Promise<any> | Effect.Effect<any, any>
export type ResourceHandler = (uri: string) => Promise<any> | Effect.Effect<any, any>

export interface HandlerLoaderService {
  readonly loadToolHandler: (handlerPath: string) => Effect.Effect<ToolHandler, HandlerNotFoundError>
  readonly loadResourceHandler: (handlerPath: string) => Effect.Effect<ResourceHandler, HandlerNotFoundError>
  readonly clearCache: () => Effect.Effect<void>
}

export const HandlerLoaderService = Context.GenericTag<HandlerLoaderService>("@adf/HandlerLoaderService")

export const HandlerLoaderServiceLive = Layer.effect(
  HandlerLoaderService,
  Effect.gen(function* () {
    const logger = yield* LoggerService
    const config = yield* ConfigService
    const basePath = yield* config.getHandlersPath()
    
    // Create a cache for loaded handlers with 5-minute TTL
    const cache = yield* Cache.make({
      capacity: 100,
      timeToLive: Duration.minutes(5),
      lookup: (key: string) => loadHandler(key, basePath, logger)
    })
    
    return {
      loadToolHandler: (handlerPath: string) =>
        Effect.gen(function* () {
          yield* logger.debug(`Loading tool handler: ${handlerPath}`)
          const handler = yield* cache.get(handlerPath)
          return handler as ToolHandler
        }),
      
      loadResourceHandler: (handlerPath: string) =>
        Effect.gen(function* () {
          yield* logger.debug(`Loading resource handler: ${handlerPath}`)
          const handler = yield* cache.get(handlerPath)
          return handler as ResourceHandler
        }),
      
      clearCache: () =>
        Effect.gen(function* () {
          yield* cache.invalidateAll
          yield* logger.info("Handler cache cleared")
        })
    }
  })
)

// Helper function to load a handler
const loadHandler = (
  handlerPath: string,
  basePath: string,
  logger: LoggerService
): Effect.Effect<any, HandlerNotFoundError> =>
  Effect.gen(function* () {
    const fullPath = path.isAbsolute(handlerPath) 
      ? handlerPath 
      : path.join(process.cwd(), basePath, handlerPath)
    
    const modulePath = fullPath.endsWith('.js') || fullPath.endsWith('.ts')
      ? fullPath
      : `${fullPath}.js`
    
    try {
      const moduleUrl = pathToFileURL(modulePath).href
      const module = yield* Effect.tryPromise({
        try: () => import(moduleUrl),
        catch: () => new HandlerNotFoundError({
          handlerName: handlerPath,
          path: modulePath
        })
      })
      
      const handler = module.default || module.handler || module
      
      if (typeof handler !== 'function') {
        return yield* Effect.fail(new HandlerNotFoundError({
          handlerName: handlerPath,
          path: modulePath
        }))
      }
      
      yield* logger.info(`Successfully loaded handler: ${handlerPath}`)
      return handler
      
    } catch {
      yield* logger.warn(`Failed to load handler ${handlerPath}, using default`)
      
      // Return a default handler that logs and returns a basic response
      return async (args: any) => ({
        success: true,
        message: `Default handler for ${handlerPath}`,
        args
      })
    }
  })

// Test implementation
export const HandlerLoaderServiceTest = Layer.succeed(
  HandlerLoaderService,
  {
    loadToolHandler: () => Effect.succeed(async () => ({ success: true })),
    loadResourceHandler: () => Effect.succeed(async () => ({ data: "test" })),
    clearCache: () => Effect.void
  }
)