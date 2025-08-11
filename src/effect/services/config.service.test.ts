import { describe, it, expect } from '@jest/globals'
import { Effect, Layer } from 'effect'
import { ConfigService, makeConfigService } from './config.service'
import type { ADF } from '../../types/adf-schema'

describe('ConfigService', () => {
  const mockADF: ADF = {
    version: '1.0',
    agent: {
      name: 'test-agent',
      description: 'Test agent',
      handlers: {
        path: './custom-handlers',
        runtime: 'typescript'
      }
    }
  }

  it('should provide configuration from ADF', async () => {
    const ConfigLayer = makeConfigService(mockADF)
    
    const program = Effect.gen(function* () {
      const config = yield* ConfigService
      const handlersPath = yield* config.getHandlersPath()
      const timeout = yield* config.getTimeout()
      const retryPolicy = yield* config.getRetryPolicy()
      
      return { handlersPath, timeout, retryPolicy }
    })
    
    const result = await Effect.runPromise(program.pipe(Effect.provide(ConfigLayer)))
    
    expect(result.handlersPath).toBe('./custom-handlers')
    expect(result.timeout).toBe(30000) // default timeout
    expect(result.retryPolicy).toEqual({
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      factor: 2
    })
  })

  it('should use default values when handlers not specified', async () => {
    const minimalADF: ADF = {
      version: '1.0',
      agent: {
        name: 'minimal-agent',
        description: 'Minimal agent'
      }
    }
    
    const ConfigLayer = makeConfigService(minimalADF)
    
    const program = Effect.gen(function* () {
      const config = yield* ConfigService
      return yield* config.getHandlersPath()
    })
    
    const result = await Effect.runPromise(program.pipe(Effect.provide(ConfigLayer)))
    expect(result).toBe('./handlers')
  })
})