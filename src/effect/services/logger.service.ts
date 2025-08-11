import { Context, Effect, Layer } from "effect"

export interface LoggerService {
  readonly info: (message: string, data?: any) => Effect.Effect<void>
  readonly error: (message: string, error?: unknown) => Effect.Effect<void>
  readonly debug: (message: string, data?: any) => Effect.Effect<void>
  readonly warn: (message: string, data?: any) => Effect.Effect<void>
}

export const LoggerService = Context.GenericTag<LoggerService>("@adf/LoggerService")

export const LoggerServiceLive = Layer.succeed(
  LoggerService,
  {
    info: (message, data) => 
      Effect.sync(() => {
        const timestamp = new Date().toISOString()
        console.log(`[${timestamp}] [INFO] ${message}`, data ? data : '')
      }),
    
    error: (message, error) => 
      Effect.sync(() => {
        const timestamp = new Date().toISOString()
        console.error(`[${timestamp}] [ERROR] ${message}`, error ? error : '')
      }),
    
    debug: (message, data) => 
      Effect.sync(() => {
        if (process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV === 'development') {
          const timestamp = new Date().toISOString()
          console.debug(`[${timestamp}] [DEBUG] ${message}`, data ? data : '')
        }
      }),
    
    warn: (message, data) => 
      Effect.sync(() => {
        const timestamp = new Date().toISOString()
        console.warn(`[${timestamp}] [WARN] ${message}`, data ? data : '')
      })
  }
)

// Test implementation for unit tests
export const LoggerServiceTest = Layer.succeed(
  LoggerService,
  {
    info: () => Effect.void,
    error: () => Effect.void,
    debug: () => Effect.void,
    warn: () => Effect.void
  }
)