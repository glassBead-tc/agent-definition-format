# Effect-TS Integration Implementation Guide

## Quick Start

### Prerequisites
```bash
# Install Effect-TS dependencies
npm install effect @effect/platform @effect/schema @effect/vitest
npm install -D @effect/language-service
```

### VSCode Configuration
```json
{
  "typescript.tsserver.pluginPaths": ["@effect/language-service"]
}
```

## Core Patterns

### 1. Service Definition Pattern
```typescript
// services/logger.service.ts
import { Context, Effect, Layer } from "effect"

export interface LoggerService {
  readonly info: (message: string) => Effect.Effect<void>
  readonly error: (message: string, error?: unknown) => Effect.Effect<void>
  readonly debug: (message: string) => Effect.Effect<void>
}

export const LoggerService = Context.GenericTag<LoggerService>("@adf/LoggerService")

export const LoggerServiceLive = Layer.succeed(
  LoggerService,
  {
    info: (message) => Effect.sync(() => console.log(`[INFO] ${message}`)),
    error: (message, error) => Effect.sync(() => console.error(`[ERROR] ${message}`, error)),
    debug: (message) => Effect.sync(() => console.debug(`[DEBUG] ${message}`))
  }
)
```

### 2. Error Handling Pattern
```typescript
// errors/domain.errors.ts
import { Schema } from "@effect/schema"
import { Data } from "effect"

// Define error types with Schema
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string
  readonly message: string
}> {}

export class HandlerNotFoundError extends Data.TaggedError("HandlerNotFoundError")<{
  readonly handlerName: string
}> {}

export class WorkflowExecutionError extends Data.TaggedError("WorkflowExecutionError")<{
  readonly workflowId: string
  readonly state: string
  readonly cause: unknown
}> {}

// Union type for all domain errors
export type ADFError = 
  | ValidationError 
  | HandlerNotFoundError 
  | WorkflowExecutionError
```

### 3. Handler Implementation Pattern
```typescript
// handlers/email.handler.ts
import { Effect, Layer, Context } from "effect"
import { Schema } from "@effect/schema"

// Define handler input/output schemas
const EmailInput = Schema.Struct({
  to: Schema.String,
  subject: Schema.String,
  body: Schema.String
})

const EmailOutput = Schema.Struct({
  messageId: Schema.String,
  status: Schema.Literal("sent", "queued")
})

// Handler service definition
export interface EmailHandler {
  readonly send: (input: unknown) => Effect.Effect<
    Schema.Schema.Type<typeof EmailOutput>,
    ValidationError | SMTPError
  >
}

export const EmailHandler = Context.GenericTag<EmailHandler>("@adf/EmailHandler")

// Implementation
export const EmailHandlerLive = Layer.effect(
  EmailHandler,
  Effect.gen(function* () {
    const smtp = yield* SMTPService
    const logger = yield* LoggerService
    
    return {
      send: (input) =>
        Effect.gen(function* () {
          // Validate input
          const validated = yield* Schema.decode(EmailInput)(input).pipe(
            Effect.mapError((e) => new ValidationError({
              field: "email",
              message: e.message
            }))
          )
          
          // Send email
          yield* logger.info(`Sending email to ${validated.to}`)
          const result = yield* smtp.send(validated)
          
          return {
            messageId: result.id,
            status: "sent" as const
          }
        })
    }
  })
)
```

### 4. Workflow Execution Pattern
```typescript
// runtime/workflow-executor.ts
import { Effect, Stream, Queue, Fiber } from "effect"

export class WorkflowExecutor {
  execute(workflow: Workflow) {
    return Effect.gen(function* () {
      const logger = yield* LoggerService
      const stateQueue = yield* Queue.unbounded<StateTransition>()
      
      // Start state machine fiber
      const fiber = yield* pipe(
        Stream.fromQueue(stateQueue),
        Stream.mapEffect(processState),
        Stream.runDrain,
        Effect.fork
      )
      
      // Execute workflow
      yield* stateQueue.offer({
        from: null,
        to: workflow.initial
      })
      
      // Wait for completion
      return yield* Fiber.join(fiber)
    })
  }
}
```

## Migration Examples

### Before: Promise-based Handler
```typescript
// OLD: Promise-based approach
export class HandlerLoader {
  async loadToolHandler(handlerPath: string): Promise<ToolHandler> {
    try {
      const module = await import(handlerPath)
      if (!module.default) {
        throw new Error(`Handler not found: ${handlerPath}`)
      }
      return module.default
    } catch (error) {
      console.error(`Failed to load handler: ${error}`)
      return async () => ({ success: false, error: "Handler load failed" })
    }
  }
}
```

### After: Effect-based Handler
```typescript
// NEW: Effect-based approach
export const HandlerLoader = Effect.gen(function* () {
  const logger = yield* LoggerService
  const cache = yield* HandlerCache
  
  const loadToolHandler = (handlerPath: string) =>
    Effect.gen(function* () {
      // Check cache first
      const cached = yield* cache.get(handlerPath)
      if (cached) return cached
      
      // Load handler
      const handler = yield* Effect.tryPromise({
        try: () => import(handlerPath),
        catch: (error) => new HandlerNotFoundError({
          handlerName: handlerPath
        })
      })
      
      // Validate and cache
      yield* validateHandler(handler)
      yield* cache.set(handlerPath, handler)
      
      return handler
    }).pipe(
      Effect.tap(() => logger.info(`Loaded handler: ${handlerPath}`)),
      Effect.catchTag("HandlerNotFoundError", (error) =>
        Effect.gen(function* () {
          yield* logger.error(`Handler not found: ${error.handlerName}`)
          return defaultHandler
        })
      )
    )
    
  return { loadToolHandler }
})
```

## Testing Patterns

### 1. Service Testing
```typescript
// tests/services/logger.test.ts
import { it } from "@effect/vitest"
import { Effect, Layer, TestContext } from "effect"

it.effect("should log messages correctly", () =>
  Effect.gen(function* () {
    const logs: string[] = []
    
    // Create test implementation
    const TestLogger = Layer.succeed(LoggerService, {
      info: (msg) => Effect.sync(() => { logs.push(`INFO: ${msg}`) }),
      error: (msg) => Effect.sync(() => { logs.push(`ERROR: ${msg}`) }),
      debug: (msg) => Effect.sync(() => { logs.push(`DEBUG: ${msg}`) })
    })
    
    // Run test
    const program = Effect.gen(function* () {
      const logger = yield* LoggerService
      yield* logger.info("test message")
      yield* logger.error("error message")
    })
    
    yield* program.pipe(Effect.provide(TestLogger))
    
    expect(logs).toEqual([
      "INFO: test message",
      "ERROR: error message"
    ])
  })
)
```

### 2. Workflow Testing
```typescript
// tests/workflow.test.ts
import { it } from "@effect/vitest"
import { Effect, TestClock, Duration } from "effect"

it.effect("should timeout long-running workflows", () =>
  Effect.gen(function* () {
    const workflow = createTestWorkflow()
    
    // Start workflow with timeout
    const fiber = yield* pipe(
      WorkflowExecutor.execute(workflow),
      Effect.timeout(Duration.seconds(30)),
      Effect.fork
    )
    
    // Advance time
    yield* TestClock.adjust(Duration.seconds(31))
    
    // Check timeout
    const result = yield* Fiber.join(fiber)
    expect(result).toBeInstanceOf(TimeoutError)
  })
)
```

## Performance Optimization

### 1. Caching Pattern
```typescript
import { Effect, Cache, Duration } from "effect"

export const CachedHandlerLoader = Effect.gen(function* () {
  const cache = yield* Cache.make({
    capacity: 100,
    timeToLive: Duration.minutes(5),
    lookup: (key: string) => loadHandler(key)
  })
  
  return {
    get: (path: string) => cache.get(path)
  }
})
```

### 2. Concurrency Control
```typescript
import { Effect, RateLimiter } from "effect"

export const RateLimitedAPI = Effect.gen(function* () {
  const limiter = yield* RateLimiter.make({
    limit: 10,
    interval: Duration.seconds(1)
  })
  
  const call = (request: Request) =>
    Effect.gen(function* () {
      yield* limiter.take(1)
      return yield* makeAPICall(request)
    })
    
  return { call }
})
```

## Observability

### 1. Tracing Setup
```typescript
import { Effect, Layer } from "effect"
import { NodeSdk } from "@effect/opentelemetry"

export const TracingLive = Layer.effect(
  Layer.empty,
  Effect.gen(function* () {
    const sdk = yield* NodeSdk.layer({
      resource: {
        serviceName: "adf-runtime"
      }
    })
    
    yield* Effect.log("Tracing initialized")
    return sdk
  })
)
```

### 2. Metrics Collection
```typescript
import { Metric, Effect } from "effect"

const workflowCounter = Metric.counter("workflow.executions")
const workflowDuration = Metric.histogram("workflow.duration")

export const instrumentedWorkflow = (workflow: Workflow) =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis
    
    yield* Metric.increment(workflowCounter)
    
    const result = yield* executeWorkflow(workflow)
    
    const duration = yield* Clock.currentTimeMillis
    yield* Metric.update(workflowDuration, duration - start)
    
    return result
  })
```

## Common Pitfalls & Solutions

### 1. Generator Function Syntax
```typescript
// ❌ Wrong - Missing yield*
Effect.gen(function* () {
  const logger = LoggerService // Missing yield*
  logger.info("test") // Won't work
})

// ✅ Correct
Effect.gen(function* () {
  const logger = yield* LoggerService
  yield* logger.info("test")
})
```

### 2. Layer Composition
```typescript
// ❌ Wrong - Circular dependency
const ServiceA = Layer.effect(ServiceATag, 
  Effect.gen(function* () {
    const b = yield* ServiceBTag // ServiceB depends on ServiceA!
  })
)

// ✅ Correct - Break circular dependency
const ServiceA = Layer.succeed(ServiceATag, {...})
const ServiceB = Layer.effect(ServiceBTag, 
  Effect.gen(function* () {
    const a = yield* ServiceATag
  })
).pipe(Layer.provide(ServiceA))
```

### 3. Error Handling
```typescript
// ❌ Wrong - Losing error information
Effect.catchAll(() => Effect.succeed(defaultValue))

// ✅ Correct - Preserve error context
Effect.catchAll((error) => 
  Effect.gen(function* () {
    yield* Logger.error("Operation failed", error)
    yield* Metric.increment("errors")
    return defaultValue
  })
)
```

## Gradual Migration Strategy

### Phase 1: New Features Only
- Implement all new features using Effect
- Keep existing Promise-based code

### Phase 2: Service Layer
- Convert services to Effect
- Create compatibility adapters

### Phase 3: Core Runtime
- Migrate ADFRuntime to Effect
- Update handler system

### Phase 4: Complete Migration
- Convert remaining components
- Remove compatibility layers

## Tooling & Development

### Recommended Extensions
- Effect Language Service for VSCode
- Effect Snippets

### Debug Configuration
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Effect App",
  "program": "${workspaceFolder}/dist/index.js",
  "env": {
    "NODE_ENV": "development",
    "EFFECT_LOG_LEVEL": "Debug"
  }
}
```

## Resources

- [Effect-TS Docs](https://effect.website/docs)
- [Effect Discord](https://discord.gg/effect-ts)
- [Effect Examples](https://github.com/effect-ts/examples)
- [Effect Platform Guide](https://effect.website/docs/platform)

---

*This implementation guide provides practical patterns and examples for integrating Effect-TS into the ADF project.*