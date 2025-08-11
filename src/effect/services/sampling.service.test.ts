import { describe, it, expect } from '@jest/globals'
import { Effect, Layer, Stream, Chunk } from 'effect'
import { SamplingService, SamplingServiceLive } from './sampling.service'
import { LoggerService } from './logger.service'
import { ConfigService } from './config.service'
import type { Sampling } from '../../types/adf-schema'

describe('SamplingService', () => {
  const TestLogger = Layer.succeed(LoggerService, {
    info: () => Effect.void,
    error: () => Effect.void,
    debug: () => Effect.void,
    warn: () => Effect.void
  })
  
  const TestConfig = Layer.succeed(ConfigService, {
    getHandlersPath: () => Effect.succeed('./handlers'),
    getTimeout: () => Effect.succeed(5000),
    getRetryPolicy: () => Effect.succeed({
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      factor: 2
    })
  })
  
  const TestLayers = Layer.mergeAll(TestLogger, TestConfig, SamplingServiceLive)

  describe('validateSampling', () => {
    it('should validate sampling parameters', async () => {
      const validSampling: Sampling = {
        prompt: 'Test prompt',
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.95
      }
      
      const program = Effect.gen(function* () {
        const service = yield* SamplingService
        return yield* service.validateSampling(validSampling)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(true)
    })

    it('should reject invalid temperature', async () => {
      const invalidSampling: Sampling = {
        prompt: 'Test prompt',
        temperature: 3.0 // Out of range
      }
      
      const program = Effect.gen(function* () {
        const service = yield* SamplingService
        return yield* service.validateSampling(invalidSampling)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(false)
    })

    it('should reject invalid top_p', async () => {
      const invalidSampling: Sampling = {
        prompt: 'Test prompt',
        top_p: 1.5 // Out of range
      }
      
      const program = Effect.gen(function* () {
        const service = yield* SamplingService
        return yield* service.validateSampling(invalidSampling)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(false)
    })
  })

  describe('createCompletion', () => {
    it('should create completion with basic prompt', async () => {
      const sampling: Sampling = {
        prompt: 'Hello, world!'
      }
      
      const program = Effect.gen(function* () {
        const service = yield* SamplingService
        return yield* service.createCompletion(sampling)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.content).toContain('mock completion')
      expect(result.content).toContain('Hello, world!')
      expect(result.model).toBe('claude-3-sonnet')
    })

    it('should handle context variables', async () => {
      const sampling: Sampling = {
        prompt: 'Hello, {name}!',
        context: ['user_data']
      }
      
      const context = {
        name: 'Alice',
        user_data: { role: 'developer' }
      }
      
      const program = Effect.gen(function* () {
        const service = yield* SamplingService
        return yield* service.createCompletion(sampling, context)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.content).toContain('Hello, Alice!')
      expect(result.metadata?.messages).toBeGreaterThan(1)
    })

    it('should use custom model and parameters', async () => {
      const sampling: Sampling = {
        prompt: 'Test',
        model: 'claude-3-opus',
        temperature: 0.9,
        max_tokens: 2000
      }
      
      const program = Effect.gen(function* () {
        const service = yield* SamplingService
        return yield* service.createCompletion(sampling)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.content).toContain('claude-3-opus')
      expect(result.metadata?.temperature).toBe(0.9)
      expect(result.metadata?.max_tokens).toBe(2000)
    })
  })

  describe('streamCompletion', () => {
    it('should stream completion chunks', async () => {
      const sampling: Sampling = {
        prompt: 'Stream test'
      }
      
      const program = Effect.gen(function* () {
        const service = yield* SamplingService
        const stream = service.streamCompletion(sampling)
        const chunks = yield* Stream.runCollect(stream)
        return Chunk.toArray(chunks)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.length).toBeGreaterThan(0)
      expect(result.join('')).toContain('simulated streaming response')
    })

    it('should call chunk callback', async () => {
      const sampling: Sampling = {
        prompt: 'Stream test'
      }
      
      const chunks: string[] = []
      
      const program = Effect.gen(function* () {
        const service = yield* SamplingService
        const stream = service.streamCompletion(sampling, undefined, {
          onChunk: (chunk) => chunks.push(chunk)
        })
        yield* Stream.runDrain(stream)
        return chunks
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.length).toBeGreaterThan(0)
      expect(result.join(' ')).toContain('simulated')
    })
  })
})