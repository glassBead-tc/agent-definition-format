import { describe, it, expect } from '@jest/globals'
import { Effect, Layer, Stream } from 'effect'
import { WorkflowExecutor, WorkflowExecutorLive } from './workflow-executor'
import { LoggerService } from '../services/logger.service'
import { ConfigService } from '../services/config.service'
import { ElicitationService } from '../services/elicitation.service'
import { SamplingService } from '../services/sampling.service'
import { HandlerLoaderService } from '../services/handler-loader.service'
import type { Workflow } from '../../types/adf-schema'

describe('WorkflowExecutor', () => {
  // Create test implementations of services
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
  
  const TestElicitation = Layer.succeed(ElicitationService, {
    requestElicitation: () => Effect.succeed({
      value: 'test-response',
      isValid: true,
      metadata: {}
    }),
    validateResponse: () => Effect.succeed(true),
    formatPrompt: () => Effect.succeed('Test prompt')
  })
  
  const TestSampling = Layer.succeed(SamplingService, {
    createCompletion: () => Effect.succeed({
      content: 'Test completion',
      model: 'test-model',
      tokens: 100
    }),
    streamCompletion: () => Stream.make('Test', ' ', 'stream'),
    validateSampling: () => Effect.succeed(true)
  })
  
  const TestHandlerLoader = Layer.succeed(HandlerLoaderService, {
    loadToolHandler: () => Effect.succeed(async () => ({ result: 'tool-result' })),
    loadResourceHandler: () => Effect.succeed(async () => ({ data: 'resource-data' })),
    clearCache: () => Effect.void
  })
  
  const TestLayers = Layer.mergeAll(
    TestLogger,
    TestConfig,
    TestElicitation,
    TestSampling,
    TestHandlerLoader,
    WorkflowExecutorLive
  )

  describe('validateWorkflow', () => {
    it('should validate a simple workflow', async () => {
      const workflow: Workflow = {
        initial: 'start',
        states: {
          start: {
            type: 'response',
            template: 'Hello'
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.validateWorkflow(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(true)
    })

    it('should detect missing initial state', async () => {
      const workflow: Workflow = {
        initial: 'missing',
        states: {
          start: {
            type: 'response',
            template: 'Hello'
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.validateWorkflow(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(false)
    })

    it('should detect invalid transitions', async () => {
      const workflow: Workflow = {
        initial: 'start',
        states: {
          start: {
            type: 'response',
            template: 'Hello',
            transitions: {
              default: 'missing_state'
            }
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.validateWorkflow(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(false)
    })

    it('should detect unreachable states', async () => {
      const workflow: Workflow = {
        initial: 'start',
        states: {
          start: {
            type: 'response',
            template: 'Hello',
            transitions: {
              default: 'end'
            }
          },
          end: {
            type: 'response',
            template: 'Goodbye'
          },
          unreachable: {
            type: 'response',
            template: 'Never reached'
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.validateWorkflow(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result).toBe(true) // Should be valid but log warning
    })
  })

  describe('execute', () => {
    it('should execute a simple linear workflow', async () => {
      const workflow: Workflow = {
        initial: 'greeting',
        states: {
          greeting: {
            type: 'response',
            template: 'Hello {name}',
            transitions: {
              default: 'farewell'
            }
          },
          farewell: {
            type: 'response',
            template: 'Goodbye {name}'
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.execute(workflow, { name: 'Alice' })
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.currentState).toBe('farewell')
      expect(result.variables.name).toBe('Alice')
      expect(result.history.length).toBeGreaterThan(0)
    })

    it('should handle conditional branching', async () => {
      const workflow: Workflow = {
        initial: 'check',
        states: {
          check: {
            type: 'conditional',
            condition: 'hasAccess',
            onTrue: 'granted',
            onFalse: 'denied'
          },
          granted: {
            type: 'response',
            template: 'Access granted'
          },
          denied: {
            type: 'response',
            template: 'Access denied'
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        const withAccess = yield* executor.execute(workflow, { hasAccess: true })
        const withoutAccess = yield* executor.execute(workflow, { hasAccess: false })
        return { withAccess, withoutAccess }
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.withAccess.currentState).toBe('granted')
      expect(result.withoutAccess.currentState).toBe('denied')
    })

    it('should handle elicitation states', async () => {
      const workflow: Workflow = {
        initial: 'ask',
        states: {
          ask: {
            type: 'elicitation',
            prompt: 'What is your name?',
            elicitation: {
              type: 'text',
              prompt: 'Enter your name'
            },
            transitions: {
              default: 'greet'
            }
          },
          greet: {
            type: 'response',
            template: 'Hello {ask_response}'
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.execute(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.currentState).toBe('greet')
      expect(result.variables.ask_response).toBe('test-response')
    })

    it('should handle sampling states', async () => {
      const workflow: Workflow = {
        initial: 'generate',
        states: {
          generate: {
            type: 'sampling',
            prompt: 'Generate a greeting',
            transitions: {
              default: 'done'
            }
          },
          done: {
            type: 'response',
            template: 'Generated: {generate_completion}'
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.execute(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.currentState).toBe('done')
      expect(result.variables.generate_completion).toBe('Test completion')
    })

    it('should handle tool execution states', async () => {
      const workflow: Workflow = {
        initial: 'call_tool',
        states: {
          call_tool: {
            type: 'tool',
            tool: 'test_tool',
            parameters: {
              input: 'test'
            },
            transitions: {
              default: 'show_result'
            }
          },
          show_result: {
            type: 'response',
            template: 'Result: {call_tool_result}'
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.execute(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.currentState).toBe('show_result')
      expect(result.variables.call_tool_result).toEqual({ result: 'tool-result' })
    })

    it('should stop at terminal states', async () => {
      const workflow: Workflow = {
        initial: 'start',
        maxSteps: 10,
        states: {
          start: {
            type: 'response',
            template: 'Starting',
            transitions: {
              default: 'middle'
            }
          },
          middle: {
            type: 'response',
            template: 'Processing',
            transitions: {
              default: 'end'
            }
          },
          end: {
            type: 'response',
            template: 'Complete'
            // No transitions - terminal state
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.execute(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.currentState).toBe('end')
      expect(result.history.length).toBe(3)
    })

    it('should respect maxSteps limit', async () => {
      const workflow: Workflow = {
        initial: 'loop',
        maxSteps: 5,
        states: {
          loop: {
            type: 'response',
            template: 'Looping',
            transitions: {
              default: 'loop' // Infinite loop
            }
          }
        }
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.execute(workflow)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.currentState).toBe('loop')
      expect(result.history.length).toBe(5)
    })
  })

  describe('step', () => {
    it('should execute a single workflow step', async () => {
      const workflow: Workflow = {
        initial: 'start',
        states: {
          start: {
            type: 'response',
            template: 'Hello',
            transitions: {
              default: 'next'
            }
          },
          next: {
            type: 'response',
            template: 'World'
          }
        }
      }
      
      const initialContext = {
        currentState: 'start',
        variables: {},
        history: []
      }
      
      const program = Effect.gen(function* () {
        const executor = yield* WorkflowExecutor
        return yield* executor.step(workflow, initialContext)
      })
      
      const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayers)))
      expect(result.currentState).toBe('next')
      expect(result.history.length).toBe(1)
      expect(result.history[0].state).toBe('start')
    })
  })
})