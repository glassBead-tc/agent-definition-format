import { Context, Effect, Layer, pipe } from "effect"
import { LoggerService } from './logger.service.js'
import { ElicitationError, ValidationError } from '../errors/domain.errors.js'
import type { Elicitation } from '../../types/adf-schema.js'

export interface ElicitationResult {
  value: any
  isValid: boolean
  metadata?: Record<string, any>
}

export interface ElicitationService {
  readonly requestElicitation: (
    elicitation: Elicitation,
    context?: Record<string, any>
  ) => Effect.Effect<ElicitationResult, ElicitationError | ValidationError>
  
  readonly validateResponse: (
    response: any,
    elicitation: Elicitation
  ) => Effect.Effect<boolean, ValidationError>
  
  readonly formatPrompt: (
    elicitation: Elicitation,
    context?: Record<string, any>
  ) => Effect.Effect<string>
}

export const ElicitationService = Context.GenericTag<ElicitationService>("@adf/ElicitationService")

export const ElicitationServiceLive = Layer.effect(
  ElicitationService,
  Effect.gen(function* () {
    const logger = yield* LoggerService
    
    const formatPrompt = (
      elicitation: Elicitation,
      context?: Record<string, any>
    ): Effect.Effect<string> =>
      Effect.gen(function* () {
        let prompt = elicitation.prompt
        
        // Replace context variables in prompt
        if (context) {
          Object.entries(context).forEach(([key, value]) => {
            prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), String(value))
          })
        }
        
        // Add type-specific formatting
        switch (elicitation.type) {
          case 'select':
            if (elicitation.options) {
              prompt += '\nOptions:\n' + elicitation.options
                .map((opt, i) => `${i + 1}. ${opt}`)
                .join('\n')
            }
            break
            
          case 'confirm':
            prompt += ' (yes/no)'
            break
            
          case 'number':
            if (elicitation.min !== undefined || elicitation.max !== undefined) {
              const range = []
              if (elicitation.min !== undefined) range.push(`min: ${elicitation.min}`)
              if (elicitation.max !== undefined) range.push(`max: ${elicitation.max}`)
              prompt += ` (${range.join(', ')})`
            }
            break
        }
        
        return prompt
      })
    
    const validateResponse = (
      response: any,
      elicitation: Elicitation
    ): Effect.Effect<boolean, ValidationError> =>
      Effect.gen(function* () {
        yield* logger.debug(`Validating response for ${elicitation.type} elicitation`)
        
        switch (elicitation.type) {
          case 'text':
            if (typeof response !== 'string') {
              return yield* Effect.fail(new ValidationError({
                field: 'response',
                message: 'Response must be a string',
                value: response
              }))
            }
            if (elicitation.pattern) {
              const regex = new RegExp(elicitation.pattern)
              if (!regex.test(response)) {
                return yield* Effect.fail(new ValidationError({
                  field: 'response',
                  message: `Response does not match pattern: ${elicitation.pattern}`,
                  value: response
                }))
              }
            }
            break
            
          case 'number':
            const num = Number(response)
            if (isNaN(num)) {
              return yield* Effect.fail(new ValidationError({
                field: 'response',
                message: 'Response must be a number',
                value: response
              }))
            }
            if (elicitation.min !== undefined && num < elicitation.min) {
              return yield* Effect.fail(new ValidationError({
                field: 'response',
                message: `Response must be >= ${elicitation.min}`,
                value: response
              }))
            }
            if (elicitation.max !== undefined && num > elicitation.max) {
              return yield* Effect.fail(new ValidationError({
                field: 'response',
                message: `Response must be <= ${elicitation.max}`,
                value: response
              }))
            }
            break
            
          case 'confirm':
            const normalizedResponse = String(response).toLowerCase()
            if (!['yes', 'no', 'y', 'n', 'true', 'false'].includes(normalizedResponse)) {
              return yield* Effect.fail(new ValidationError({
                field: 'response',
                message: 'Response must be yes/no',
                value: response
              }))
            }
            break
            
          case 'select':
            if (!elicitation.options?.includes(String(response))) {
              // Also check if response is a valid index
              const index = Number(response) - 1
              if (isNaN(index) || index < 0 || index >= (elicitation.options?.length || 0)) {
                return yield* Effect.fail(new ValidationError({
                  field: 'response',
                  message: `Response must be one of: ${elicitation.options?.join(', ')}`,
                  value: response
                }))
              }
            }
            break
        }
        
        return true
      })
    
    const requestElicitation = (
      elicitation: Elicitation,
      context?: Record<string, any>
    ): Effect.Effect<ElicitationResult, ElicitationError | ValidationError> =>
      Effect.gen(function* () {
        yield* logger.info(`Requesting ${elicitation.type} elicitation`)
        
        const prompt = yield* formatPrompt(elicitation, context)
        yield* logger.debug(`Formatted prompt: ${prompt}`)
        
        // In a real implementation, this would interact with the MCP client
        // For now, we'll simulate with a mock response
        const mockResponse = yield* getMockResponse(elicitation)
        
        // Validate the response
        const isValid = yield* pipe(
          validateResponse(mockResponse, elicitation),
          Effect.catchAll(() => Effect.succeed(false))
        )
        
        if (!isValid && elicitation.required !== false) {
          return yield* Effect.fail(new ElicitationError({
            type: elicitation.type,
            prompt: elicitation.prompt,
            message: 'Invalid response received'
          }))
        }
        
        // Transform response based on type
        const transformedValue = yield* transformResponse(mockResponse, elicitation)
        
        yield* logger.info(`Elicitation completed: ${JSON.stringify(transformedValue)}`)
        
        return {
          value: transformedValue,
          isValid,
          metadata: {
            prompt,
            originalResponse: mockResponse,
            elicitationType: elicitation.type
          }
        }
      })
    
    return {
      requestElicitation,
      validateResponse,
      formatPrompt
    }
  })
)

// Helper function to get mock response (replace with actual MCP client interaction)
const getMockResponse = (elicitation: Elicitation): Effect.Effect<any> =>
  Effect.gen(function* () {
    switch (elicitation.type) {
      case 'text':
        return 'Sample text response'
      case 'number':
        return elicitation.min || 42
      case 'confirm':
        return 'yes'
      case 'select':
        return elicitation.options?.[0] || 'Option 1'
      default:
        return 'default response'
    }
  })

// Helper function to transform response based on type
const transformResponse = (response: any, elicitation: Elicitation): Effect.Effect<any> =>
  Effect.gen(function* () {
    switch (elicitation.type) {
      case 'number':
        return Number(response)
        
      case 'confirm':
        const normalized = String(response).toLowerCase()
        return normalized === 'yes' || normalized === 'y' || normalized === 'true'
        
      case 'select':
        // Handle both option value and index
        const index = Number(response) - 1
        if (!isNaN(index) && elicitation.options && index >= 0 && index < elicitation.options.length) {
          return elicitation.options[index]
        }
        return response
        
      default:
        return response
    }
  })

// Test implementation for unit tests
export const ElicitationServiceTest = Layer.succeed(
  ElicitationService,
  {
    requestElicitation: () => Effect.succeed({
      value: 'test',
      isValid: true,
      metadata: {}
    }),
    validateResponse: () => Effect.succeed(true),
    formatPrompt: () => Effect.succeed('Test prompt')
  }
)