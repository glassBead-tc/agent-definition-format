import { Context, Effect, Layer, Stream, Schedule, Duration, pipe } from "effect"
import { LoggerService } from './logger.service.js'
import { ConfigService } from './config.service.js'
import { SamplingError, TimeoutError } from '../errors/domain.errors.js'
import type { Sampling } from '../../types/adf-schema.js'

export interface SamplingResult {
  content: string
  model?: string
  tokens?: number
  metadata?: Record<string, any>
}

export interface StreamingOptions {
  onChunk?: (chunk: string) => void
  onProgress?: (progress: number) => void
}

export interface SamplingService {
  readonly createCompletion: (
    sampling: Sampling,
    context?: Record<string, any>
  ) => Effect.Effect<SamplingResult, SamplingError | TimeoutError>
  
  readonly streamCompletion: (
    sampling: Sampling,
    context?: Record<string, any>,
    options?: StreamingOptions
  ) => Stream.Stream<string, SamplingError>
  
  readonly validateSampling: (
    sampling: Sampling
  ) => Effect.Effect<boolean>
}

export const SamplingService = Context.GenericTag<SamplingService>("@adf/SamplingService")

export const SamplingServiceLive = Layer.effect(
  SamplingService,
  Effect.gen(function* () {
    const logger = yield* LoggerService
    const config = yield* ConfigService
    
    const formatPrompt = (
      prompt: string,
      context?: Record<string, any>
    ): string => {
      let formattedPrompt = prompt
      
      // Replace context variables
      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          formattedPrompt = formattedPrompt.replace(
            new RegExp(`{${key}}`, 'g'),
            String(value)
          )
        })
      }
      
      return formattedPrompt
    }
    
    const buildMessages = (
      sampling: Sampling,
      context?: Record<string, any>
    ): Array<{ role: string; content: string }> => {
      const messages = []
      
      // Add system message if present
      if (sampling.system) {
        messages.push({
          role: 'system',
          content: formatPrompt(sampling.system, context)
        })
      }
      
      // Add context as assistant messages if specified
      if (sampling.context && context) {
        sampling.context.forEach((key: string) => {
          if (context[key]) {
            messages.push({
              role: 'assistant',
              content: `Context for ${key}: ${JSON.stringify(context[key])}`
            })
          }
        })
      }
      
      // Add main prompt
      messages.push({
        role: 'user',
        content: formatPrompt(sampling.prompt, context)
      })
      
      return messages
    }
    
    const validateSampling = (
      sampling: Sampling
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        yield* logger.debug('Validating sampling configuration')
        
        // Validate temperature
        if (sampling.temperature !== undefined) {
          if (sampling.temperature < 0 || sampling.temperature > 2) {
            yield* logger.warn(`Invalid temperature: ${sampling.temperature}`)
            return false
          }
        }
        
        // Validate max_tokens
        if (sampling.max_tokens !== undefined) {
          if (sampling.max_tokens < 1 || sampling.max_tokens > 100000) {
            yield* logger.warn(`Invalid max_tokens: ${sampling.max_tokens}`)
            return false
          }
        }
        
        // Validate top_p
        if (sampling.top_p !== undefined) {
          if (sampling.top_p < 0 || sampling.top_p > 1) {
            yield* logger.warn(`Invalid top_p: ${sampling.top_p}`)
            return false
          }
        }
        
        return true
      })
    
    const createCompletion = (
      sampling: Sampling,
      context?: Record<string, any>
    ): Effect.Effect<SamplingResult, SamplingError | TimeoutError> =>
      Effect.gen(function* () {
        yield* logger.info('Creating completion')
        
        // Validate sampling configuration
        const isValid = yield* validateSampling(sampling)
        if (!isValid) {
          return yield* Effect.fail(new SamplingError({
            prompt: sampling.prompt,
            message: 'Invalid sampling configuration'
          }))
        }
        
        const messages = buildMessages(sampling, context)
        const timeout = yield* config.getTimeout()
        
        // In a real implementation, this would call the MCP sampling API
        // For now, we'll simulate with a mock response
        const completion = yield* pipe(
          mockCreateCompletion(sampling, messages),
          Effect.timeout(Duration.millis(timeout)),
          Effect.retry(
            Schedule.exponential(Duration.seconds(1), 2).pipe(
              Schedule.compose(Schedule.recurs(2))
            )
          ),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(new TimeoutError({
              operation: 'Sampling completion',
              timeoutMs: timeout
            }))
          )
        )
        
        yield* logger.info(`Completion created: ${completion.content.substring(0, 50)}...`)
        
        return completion
      })
    
    const streamCompletion = (
      sampling: Sampling,
      _context?: Record<string, any>,
      options?: StreamingOptions
    ): Stream.Stream<string, SamplingError> => {
      // Simulate streaming response
      const chunks = [
        "This ", "is ", "a ", "simulated ", "streaming ",
        "response ", "from ", "the ", "Effect-based ", "SamplingService."
      ]
      
      return Stream.fromIterable(chunks).pipe(
        Stream.mapEffect((chunk) =>
          Effect.gen(function* () {
            // Simulate processing delay
            yield* Effect.sleep(Duration.millis(100))
            
            // Call progress callback if provided
            if (options?.onChunk) {
              yield* Effect.sync(() => options.onChunk!(chunk))
            }
            
            return chunk
          })
        ),
        Stream.catchAll(() =>
          Stream.fail(new SamplingError({
            prompt: sampling.prompt,
            message: `Streaming failed`
          }))
        )
      )
    }
    
    return {
      createCompletion,
      streamCompletion,
      validateSampling
    }
  })
)

// Mock implementation for testing
const mockCreateCompletion = (
  sampling: Sampling,
  messages: Array<{ role: string; content: string }>
): Effect.Effect<SamplingResult> =>
  Effect.gen(function* () {
    // Simulate API delay
    yield* Effect.sleep(Duration.millis(100))
    
    // Generate mock response based on sampling parameters
    const response = `This is a mock completion for prompt: "${sampling.prompt}". ` +
      `Model: ${sampling.model || 'default'}, ` +
      `Temperature: ${sampling.temperature || 0.7}, ` +
      `Max tokens: ${sampling.max_tokens || 1000}`
    
    return {
      content: response,
      model: sampling.model || 'claude-3-sonnet',
      tokens: response.length,
      metadata: {
        messages: messages.length,
        temperature: sampling.temperature || 0.7,
        max_tokens: sampling.max_tokens || 1000
      }
    }
  })

// Test implementation for unit tests
export const SamplingServiceTest = Layer.succeed(
  SamplingService,
  {
    createCompletion: () => Effect.succeed({
      content: 'Test completion',
      model: 'test-model',
      tokens: 100
    }),
    streamCompletion: () => Stream.make('Test', ' ', 'stream'),
    validateSampling: () => Effect.succeed(true)
  }
)