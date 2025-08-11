import { Effect, Runtime, pipe, Layer } from "effect"
import type { ADFError } from "../errors/domain.errors.js"

/**
 * Bridge between Promise and Effect worlds
 * Allows gradual migration by running Effects as Promises
 */
export const runEffectAsPromise = <A>(
  effect: Effect.Effect<A, ADFError>
): Promise<A> => {
  const runnable = pipe(
    effect,
    Effect.catchAll((error) => {
      // Convert domain errors to regular errors for Promise compatibility
      const errorMessage = `${error._tag}: ${JSON.stringify(error)}`
      return Effect.die(new Error(errorMessage))
    })
  )
  
  return Runtime.runPromise(Runtime.defaultRuntime)(runnable)
}

/**
 * Convert a Promise-based function to an Effect
 */
export const promiseToEffect = <A>(
  promiseFn: () => Promise<A>
): Effect.Effect<A, Error> => 
  Effect.tryPromise({
    try: promiseFn,
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

/**
 * Wrap an Effect-based handler to work with the existing Promise-based system
 */
export const wrapEffectHandler = <A, E>(
  effectHandler: (args: any) => Effect.Effect<A, E>
) => {
  return async (args: any): Promise<A> => {
    const effect = effectHandler(args)
    return runEffectAsPromise(effect as Effect.Effect<A, ADFError>)
  }
}

/**
 * Create a runtime with all necessary services for running Effects
 */
export const createADFRuntime = (layers: any[]) => {
  const mainLayer = layers.reduce((acc, layer) => 
    acc ? acc.pipe(Layer.provideMerge(layer)) : layer
  )
  
  return Runtime.make(mainLayer)
}