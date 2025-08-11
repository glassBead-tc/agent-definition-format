import { Context, Effect, Layer } from "effect"
import type { ADF } from "../../types/adf-schema.js"

export interface RetryPolicy {
  maxAttempts: number
  initialDelay: number
  maxDelay: number
  factor: number
}

export interface ConfigService {
  readonly getADF: () => Effect.Effect<ADF>
  readonly getLogLevel: () => Effect.Effect<string>
  readonly getHandlersPath: () => Effect.Effect<string>
  readonly getTimeout: () => Effect.Effect<number>
  readonly getMaxRetries: () => Effect.Effect<number>
  readonly getRetryPolicy: () => Effect.Effect<RetryPolicy>
}

export const ConfigService = Context.GenericTag<ConfigService>("@adf/ConfigService")

export const makeConfigService = (adf: ADF) => 
  Layer.succeed(
    ConfigService,
    {
      getADF: () => Effect.succeed(adf),
      
      getLogLevel: () => 
        Effect.succeed(process.env.LOG_LEVEL || 'info'),
      
      getHandlersPath: () => 
        Effect.succeed(adf.agent.handlers?.path || './handlers'),
      
      getTimeout: () => 
        Effect.succeed(parseInt(process.env.ADF_TIMEOUT || '30000')),
      
      getMaxRetries: () => 
        Effect.succeed(parseInt(process.env.ADF_MAX_RETRIES || '3')),
      
      getRetryPolicy: () =>
        Effect.succeed({
          maxAttempts: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          factor: 2
        })
    }
  )