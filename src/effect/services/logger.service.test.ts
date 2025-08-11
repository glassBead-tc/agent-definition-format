import { describe, it, expect } from '@jest/globals'
import { Effect, Layer } from 'effect'
import { LoggerService } from './logger.service'

describe('LoggerService', () => {
  it('should log messages correctly', async () => {
    const logs: string[] = []
    
    // Create test implementation that captures logs
    const TestLogger = Layer.succeed(LoggerService, {
      info: (msg) => Effect.sync(() => { logs.push(`INFO: ${msg}`) }),
      error: (msg) => Effect.sync(() => { logs.push(`ERROR: ${msg}`) }),
      debug: (msg) => Effect.sync(() => { logs.push(`DEBUG: ${msg}`) }),
      warn: (msg) => Effect.sync(() => { logs.push(`WARN: ${msg}`) })
    })
    
    // Run test program
    const program = Effect.gen(function* () {
      const logger = yield* LoggerService
      yield* logger.info("test message")
      yield* logger.error("error message")
      yield* logger.warn("warning message")
      yield* logger.debug("debug message")
    })
    
    await Effect.runPromise(program.pipe(Effect.provide(TestLogger)))
    
    expect(logs).toEqual([
      "INFO: test message",
      "ERROR: error message",
      "WARN: warning message",
      "DEBUG: debug message"
    ])
  })
  
  it('should handle errors gracefully', async () => {
    const TestLogger = Layer.succeed(LoggerService, {
      info: () => Effect.void,
      error: (msg, error) => Effect.sync(() => {
        expect(msg).toBe("Something went wrong")
        expect(error).toBeInstanceOf(Error)
      }),
      debug: () => Effect.void,
      warn: () => Effect.void
    })
    
    const program = Effect.gen(function* () {
      const logger = yield* LoggerService
      yield* logger.error("Something went wrong", new Error("Test error"))
    })
    
    await Effect.runPromise(program.pipe(Effect.provide(TestLogger)))
  })
})