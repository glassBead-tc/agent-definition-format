import { describe, it, expect } from '@jest/globals'
import { Effect, Layer } from 'effect'
import { ElicitationService, ElicitationServiceLive } from './elicitation.service'
import { LoggerService } from './logger.service'
import type { Elicitation } from '../../types/adf-schema'

describe('ElicitationService', () => {
  const TestLogger = Layer.succeed(LoggerService, {
    info: () => Effect.void,
    error: () => Effect.void,
    debug: () => Effect.void,
    warn: () => Effect.void
  })
  
  const TestLayers = Layer.mergeAll(TestLogger, ElicitationServiceLive)

  describe('formatPrompt', () => {
    it('should format prompts with context variables', async () => {
      const elicitation: Elicitation = {
        type: 'text',
        prompt: 'Hello {name}, please enter your {field}'
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        return yield* service.formatPrompt(elicitation, {
          name: 'Alice',
          field: 'email'
        })
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe('Hello Alice, please enter your email')
    })

    it('should add options for select type', async () => {
      const elicitation: Elicitation = {
        type: 'select',
        prompt: 'Choose an option',
        options: ['Red', 'Green', 'Blue']
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        return yield* service.formatPrompt(elicitation)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toContain('Choose an option')
      expect(result).toContain('1. Red')
      expect(result).toContain('2. Green')
      expect(result).toContain('3. Blue')
    })

    it('should add yes/no for confirm type', async () => {
      const elicitation: Elicitation = {
        type: 'confirm',
        prompt: 'Do you agree?'
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        return yield* service.formatPrompt(elicitation)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe('Do you agree? (yes/no)')
    })
  })

  describe('validateResponse', () => {
    it('should validate text responses', async () => {
      const elicitation: Elicitation = {
        type: 'text',
        prompt: 'Enter text'
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        return yield* service.validateResponse('some text', elicitation)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(true)
    })

    it('should validate text pattern', async () => {
      const elicitation: Elicitation = {
        type: 'text',
        prompt: 'Enter email',
        pattern: '^[\\w.]+@[\\w.]+\\.[a-z]+$'
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        const valid = yield* service.validateResponse('user@example.com', elicitation)
        return valid
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(true)
    })

    it('should validate number responses', async () => {
      const elicitation: Elicitation = {
        type: 'number',
        prompt: 'Enter number',
        min: 1,
        max: 100
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        return yield* service.validateResponse('42', elicitation)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(true)
    })

    it('should validate confirm responses', async () => {
      const elicitation: Elicitation = {
        type: 'confirm',
        prompt: 'Confirm?'
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        const yes = yield* service.validateResponse('yes', elicitation)
        const no = yield* service.validateResponse('no', elicitation)
        return { yes, no }
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.yes).toBe(true)
      expect(result.no).toBe(true)
    })

    it('should validate select responses', async () => {
      const elicitation: Elicitation = {
        type: 'select',
        prompt: 'Choose',
        options: ['A', 'B', 'C']
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        const byValue = yield* service.validateResponse('B', elicitation)
        const byIndex = yield* service.validateResponse('2', elicitation)
        return { byValue, byIndex }
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.byValue).toBe(true)
      expect(result.byIndex).toBe(true)
    })
  })

  describe('requestElicitation', () => {
    it('should process elicitation request', async () => {
      const elicitation: Elicitation = {
        type: 'text',
        prompt: 'Enter your name'
      }
      
      const program = Effect.gen(function* () {
        const service = yield* ElicitationService
        return yield* service.requestElicitation(elicitation)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.value).toBe('Sample text response')
      expect(result.isValid).toBe(true)
      expect(result.metadata?.elicitationType).toBe('text')
    })
  })
})