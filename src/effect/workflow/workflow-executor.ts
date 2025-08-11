import { Effect, Layer, Context, pipe, Duration, Schedule } from "effect"
import { LoggerService } from '../services/logger.service.js'
import { ConfigService } from '../services/config.service.js'
import { ElicitationService } from '../services/elicitation.service.js'
import { SamplingService } from '../services/sampling.service.js'
import { HandlerLoaderService } from '../services/handler-loader.service.js'
import { 
  WorkflowError, 
  StateTransitionError,
  TimeoutError 
} from '../errors/domain.errors.js'
import type { Workflow, State } from '../../types/adf-schema.js'

export interface WorkflowContext {
  currentState: string
  variables: Record<string, any>
  history: Array<{
    state: string
    timestamp: number
    variables: Record<string, any>
  }>
}

export interface WorkflowExecutor {
  readonly execute: (
    workflow: Workflow,
    initialContext?: Record<string, any>
  ) => Effect.Effect<WorkflowContext, WorkflowError | StateTransitionError | TimeoutError>
  
  readonly step: (
    workflow: Workflow,
    context: WorkflowContext
  ) => Effect.Effect<WorkflowContext, WorkflowError | StateTransitionError | TimeoutError>
  
  readonly validateWorkflow: (
    workflow: Workflow
  ) => Effect.Effect<boolean>
}

export const WorkflowExecutor = Context.GenericTag<WorkflowExecutor>("@adf/WorkflowExecutor")

export const WorkflowExecutorLive = Layer.effect(
  WorkflowExecutor,
  Effect.gen(function* () {
    const logger = yield* LoggerService
    const config = yield* ConfigService
    const elicitation = yield* ElicitationService
    const sampling = yield* SamplingService
    const loader = yield* HandlerLoaderService
    
    const validateWorkflow = (
      workflow: Workflow
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        yield* logger.debug(`Validating workflow: ${workflow.initial}`)
        
        // Check initial state exists
        if (!workflow.states[workflow.initial]) {
          yield* logger.error(`Initial state '${workflow.initial}' not found`)
          return false
        }
        
        // Validate all state transitions
        for (const [stateName, state] of Object.entries(workflow.states)) {
          if (state.transitions) {
            for (const [trigger, targetState] of Object.entries(state.transitions)) {
              if (targetState && !workflow.states[targetState]) {
                yield* logger.error(
                  `Invalid transition from '${stateName}' to '${targetState}' on trigger '${trigger}'`
                )
                return false
              }
            }
          }
        }
        
        // Check for unreachable states (except initial)
        const reachableStates = new Set<string>([workflow.initial])
        let changed = true
        
        while (changed) {
          changed = false
          for (const stateName of reachableStates) {
            const state = workflow.states[stateName]
            if (state.transitions) {
              for (const targetState of Object.values(state.transitions)) {
                if (targetState && !reachableStates.has(targetState)) {
                  reachableStates.add(targetState)
                  changed = true
                }
              }
            }
          }
        }
        
        const unreachableStates = Object.keys(workflow.states)
          .filter(s => !reachableStates.has(s))
        
        if (unreachableStates.length > 0) {
          yield* logger.warn(`Unreachable states detected: ${unreachableStates.join(', ')}`)
        }
        
        return true
      })
    
    const executeState = (
      state: State,
      context: WorkflowContext,
      workflow: Workflow
    ): Effect.Effect<{ result: any; nextState?: string }, any> =>
      Effect.gen(function* () {
        yield* logger.info(`Executing state: ${context.currentState} (type: ${state.type})`)
        
        let result: any = null
        let nextState: string | undefined
        
        switch (state.type) {
          case 'response':
            // Format and return response
            let response = state.template || ''
            Object.entries(context.variables).forEach(([key, value]) => {
              response = response.replace(new RegExp(`{${key}}`, 'g'), String(value))
            })
            result = response
            break
            
          case 'elicitation':
            // Request user input
            if (state.elicitation) {
              const elicitationResult = yield* elicitation.requestElicitation(
                state.elicitation,
                context.variables
              )
              result = elicitationResult.value
              context.variables[`${context.currentState}_response`] = result
            }
            break
            
          case 'sampling':
            // Generate completion
            if (state.sampling) {
              const samplingResult = yield* sampling.createCompletion(
                state.sampling,
                context.variables
              )
              result = samplingResult.content
              context.variables[`${context.currentState}_completion`] = result
            } else if (state.prompt) {
              // Simple prompt without full sampling config
              const samplingResult = yield* sampling.createCompletion(
                { prompt: state.prompt },
                context.variables
              )
              result = samplingResult.content
              context.variables[`${context.currentState}_completion`] = result
            }
            break
            
          case 'tool':
            // Execute tool handler
            if (state.tool && state.parameters) {
              const tool = { name: state.tool, handler: state.handler || state.tool }
              const handler = yield* loader.loadToolHandler(tool.handler)
              
              // Replace parameter variables
              const params = { ...state.parameters }
              Object.entries(params).forEach(([key, value]) => {
                if (typeof value === 'string') {
                  Object.entries(context.variables).forEach(([varKey, varValue]) => {
                    params[key] = value.replace(new RegExp(`{${varKey}}`, 'g'), String(varValue))
                  })
                }
              })
              
              const handlerResult = handler(params)
              result = yield* (Effect.isEffect(handlerResult)
                ? handlerResult
                : Effect.tryPromise({
                    try: async () => handlerResult,
                    catch: (error) => new WorkflowError({
                      workflowId: workflow.initial,
                      state: context.currentState,
                      message: `Tool execution failed: ${error}`
                    })
                  }))
              
              context.variables[`${context.currentState}_result`] = result
            }
            break
            
          case 'conditional':
            // Evaluate condition
            if (state.condition) {
              const conditionResult = yield* evaluateCondition(
                state.condition,
                context.variables
              )
              nextState = conditionResult ? state.onTrue : state.onFalse
              result = conditionResult
            }
            break
            
          case 'parallel':
            // Execute parallel states
            if (state.branches) {
              const branchEffects = state.branches.map(branchState =>
                executeState(
                  workflow.states[branchState],
                  { ...context, currentState: branchState },
                  workflow
                )
              )
              
              const results = yield* Effect.all(branchEffects, { concurrency: 'unbounded' })
              result = results.map(r => r.result)
              
              // Merge branch results into context
              results.forEach((r, i) => {
                context.variables[`${state.branches![i]}_result`] = r.result
              })
            }
            break
            
          case 'loop':
            // Execute loop
            if (state.condition && state.body) {
              const results = []
              let iteration = 0
              const maxIterations = state.maxIterations || 100
              
              while (iteration < maxIterations) {
                const shouldContinue = yield* evaluateCondition(
                  state.condition,
                  { ...context.variables, iteration }
                )
                
                if (!shouldContinue) break
                
                const bodyResult = yield* executeState(
                  workflow.states[state.body],
                  { ...context, currentState: state.body },
                  workflow
                )
                
                results.push(bodyResult.result)
                iteration++
              }
              
              result = results
              context.variables[`${context.currentState}_results`] = results
            }
            break
        }
        
        // Determine next state from transitions
        if (!nextState && state.transitions) {
          if (state.transitions.default) {
            nextState = state.transitions.default
          } else if (result && state.transitions[String(result)]) {
            nextState = state.transitions[String(result)]
          } else {
            // Check for pattern matching
            for (const [pattern, targetState] of Object.entries(state.transitions)) {
              if (pattern !== 'default' && matchesPattern(result, pattern)) {
                nextState = targetState
                break
              }
            }
          }
        }
        
        return { result, nextState }
      })
    
    const step = (
      workflow: Workflow,
      context: WorkflowContext
    ): Effect.Effect<WorkflowContext, WorkflowError | StateTransitionError | TimeoutError> =>
      Effect.gen(function* () {
        const currentState = workflow.states[context.currentState]
        
        if (!currentState) {
          return yield* Effect.fail(new StateTransitionError({
            fromState: context.currentState,
            toState: 'unknown',
            reason: `State '${context.currentState}' not found in workflow`
          }))
        }
        
        const timeout = yield* config.getTimeout()
        
        // Execute current state with timeout
        const { nextState } = yield* pipe(
          executeState(currentState, context, workflow),
          Effect.timeout(Duration.millis(timeout)),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(new TimeoutError({
              operation: `State execution: ${context.currentState}`,
              timeoutMs: timeout
            }))
          )
        )
        
        // Update context
        const newContext: WorkflowContext = {
          currentState: nextState || context.currentState,
          variables: context.variables,
          history: [
            ...context.history,
            {
              state: context.currentState,
              timestamp: Date.now(),
              variables: { ...context.variables }
            }
          ]
        }
        
        if (nextState && nextState !== context.currentState) {
          yield* logger.info(`Transitioning from '${context.currentState}' to '${nextState}'`)
        }
        
        return newContext
      })
    
    const execute = (
      workflow: Workflow,
      initialContext?: Record<string, any>
    ): Effect.Effect<WorkflowContext, WorkflowError | StateTransitionError | TimeoutError> =>
      Effect.gen(function* () {
        yield* logger.info(`Starting workflow execution from state: ${workflow.initial}`)
        
        // Validate workflow
        const isValid = yield* validateWorkflow(workflow)
        if (!isValid) {
          return yield* Effect.fail(new WorkflowError({
            workflowId: workflow.initial,
            state: 'validation',
            message: 'Workflow validation failed'
          }))
        }
        
        // Initialize context
        let context: WorkflowContext = {
          currentState: workflow.initial,
          variables: initialContext || {},
          history: []
        }
        
        // Execute workflow with max steps limit
        const maxSteps = workflow.maxSteps || 1000
        let steps = 0
        
        while (steps < maxSteps) {
          const previousState = context.currentState
          
          // Check for terminal state
          const state = workflow.states[context.currentState]
          if (state.type === 'response' && !state.transitions) {
            yield* logger.info(`Reached terminal state: ${context.currentState}`)
            break
          }
          
          // Execute step with retry
          context = yield* pipe(
            step(workflow, context),
            Effect.retry(
              Schedule.exponential(Duration.seconds(1), 2).pipe(
                Schedule.compose(Schedule.recurs(2))
              )
            )
          )
          
          // Check if state changed
          if (context.currentState === previousState && !state.transitions) {
            yield* logger.info(`No transition available from state: ${context.currentState}`)
            break
          }
          
          steps++
        }
        
        if (steps >= maxSteps) {
          yield* logger.warn(`Workflow execution stopped after ${maxSteps} steps`)
        }
        
        yield* logger.info(`Workflow execution completed after ${steps} steps`)
        return context
      })
    
    return {
      execute,
      step,
      validateWorkflow
    }
  })
)

// Helper function to evaluate conditions
const evaluateCondition = (
  condition: string,
  variables: Record<string, any>
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    // Simple condition evaluation
    // In a real implementation, this would use a proper expression evaluator
    
    // Check for variable existence
    if (variables[condition] !== undefined) {
      return Boolean(variables[condition])
    }
    
    // Check for simple comparisons
    const comparisonMatch = condition.match(/^(\w+)\s*(==|!=|>|<|>=|<=)\s*(.+)$/)
    if (comparisonMatch) {
      const [, varName, operator, value] = comparisonMatch
      const varValue = variables[varName]
      const compareValue = value.startsWith('"') && value.endsWith('"')
        ? value.slice(1, -1)
        : isNaN(Number(value)) ? value : Number(value)
      
      switch (operator) {
        case '==': return varValue == compareValue
        case '!=': return varValue != compareValue
        case '>': return varValue > compareValue
        case '<': return varValue < compareValue
        case '>=': return varValue >= compareValue
        case '<=': return varValue <= compareValue
      }
    }
    
    // Default to false for unknown conditions
    return false
  })

// Helper function for pattern matching
const matchesPattern = (value: any, pattern: string): boolean => {
  // Simple pattern matching
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    // Regex pattern
    const regex = new RegExp(pattern.slice(1, -1))
    return regex.test(String(value))
  }
  
  // Wildcard pattern
  if (pattern.includes('*')) {
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    return new RegExp(`^${regexPattern}$`).test(String(value))
  }
  
  return String(value) === pattern
}

// Test implementation
export const WorkflowExecutorTest = Layer.succeed(
  WorkflowExecutor,
  {
    execute: () => Effect.succeed({
      currentState: 'complete',
      variables: {},
      history: []
    }),
    step: () => Effect.succeed({
      currentState: 'next',
      variables: {},
      history: []
    }),
    validateWorkflow: () => Effect.succeed(true)
  }
)