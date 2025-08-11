import { Data } from "effect"

// Validation error for invalid input
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string
  readonly message: string
  readonly value?: unknown
}> {}

// Handler not found error
export class HandlerNotFoundError extends Data.TaggedError("HandlerNotFoundError")<{
  readonly handlerName: string
  readonly path: string
}> {}

// Workflow execution error
export class WorkflowExecutionError extends Data.TaggedError("WorkflowExecutionError")<{
  readonly workflowId: string
  readonly state: string
  readonly cause: unknown
}> {}

// Tool execution error
export class ToolExecutionError extends Data.TaggedError("ToolExecutionError")<{
  readonly toolName: string
  readonly args: unknown
  readonly cause: unknown
}> {}

// Resource not found error
export class ResourceNotFoundError extends Data.TaggedError("ResourceNotFoundError")<{
  readonly uri: string
}> {}

// State transition error
export class StateTransitionError extends Data.TaggedError("StateTransitionError")<{
  readonly fromState: string
  readonly toState: string
  readonly reason: string
}> {}

// Timeout error
export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly operation: string
  readonly timeoutMs: number
}> {}

// Configuration error
export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly key: string
  readonly message: string
}> {}

// Elicitation error
export class ElicitationError extends Data.TaggedError("ElicitationError")<{
  readonly type: string
  readonly prompt: string
  readonly message: string
}> {}

// Sampling error
export class SamplingError extends Data.TaggedError("SamplingError")<{
  readonly prompt: string
  readonly message: string
  readonly model?: string
}> {}

// Workflow error
export class WorkflowError extends Data.TaggedError("WorkflowError")<{
  readonly workflowId: string
  readonly state: string
  readonly message: string
}> {}

// Union type for all ADF errors
export type ADFError = 
  | ValidationError 
  | HandlerNotFoundError 
  | WorkflowExecutionError
  | ToolExecutionError
  | ResourceNotFoundError
  | StateTransitionError
  | TimeoutError
  | ConfigurationError
  | ElicitationError
  | SamplingError
  | WorkflowError