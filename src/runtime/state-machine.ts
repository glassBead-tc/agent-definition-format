import { createMachine, createActor, type Actor } from 'xstate';
import type { Workflow, State, ADF } from '../types/adf-schema.js';

export interface WorkflowContext {
  adf: ADF;
  currentWorkflow: string;
  variables: Record<string, any>;
  history: Array<{
    state: string;
    timestamp: number;
    data?: any;
  }>;
}

export interface WorkflowEvent {
  type: string;
  data?: any;
}

export class WorkflowStateMachine {
  private machine: any;
  private actor?: Actor<any>;

  constructor(private adf: ADF, private workflowName: string = 'main') {
    const workflow = adf.agent.workflows[workflowName];
    if (!workflow) {
      throw new Error(`Workflow '${workflowName}' not found in ADF`);
    }

    this.machine = this.buildMachine(workflow);
  }

  private buildMachine(workflow: Workflow): any {
    const states: Record<string, any> = {};
    
    for (const [stateName, stateConfig] of Object.entries(workflow.states)) {
      states[stateName] = this.buildState(stateName, stateConfig);
    }

    return createMachine({
      id: `workflow-${this.workflowName}`,
      initial: workflow.initial,
      context: {
        adf: this.adf,
        currentWorkflow: this.workflowName,
        variables: {},
        history: []
      },
      states
    });
  }

  private buildState(name: string, config: State): any {
    const state: any = {
      entry: ({ context }: any) => {
        context.history.push({
          state: name,
          timestamp: Date.now()
        });
      }
    };

    switch (config.type) {
      case 'elicitation':
        state.invoke = {
          src: 'elicitation',
          input: { config },
          onDone: {
            target: this.resolveTransition(config.transitions),
            actions: 'updateContext'
          }
        };
        break;

      case 'sampling':
        state.invoke = {
          src: 'sampling',
          input: { config },
          onDone: {
            target: this.resolveTransition(config.transitions),
            actions: 'updateContext'
          }
        };
        break;

      case 'response':
        state.type = 'final';
        state.output = { template: config.template };
        break;

      case 'tool':
        state.invoke = {
          src: 'executeTool',
          input: { toolName: config.tool },
          onDone: {
            target: this.resolveTransition(config.transitions),
            actions: 'updateContext'
          }
        };
        break;

      case 'conditional':
        state.always = [
          {
            guard: 'evaluateCondition',
            target: config.onTrue || 'error'
          },
          {
            target: config.onFalse || 'error'
          }
        ];
        break;
    }

    if (config.transitions && config.type !== 'conditional') {
      state.on = this.buildTransitions(config.transitions);
    }

    return state;
  }

  private buildTransitions(transitions?: Record<string, string>): Record<string, any> {
    if (!transitions) return {};
    
    const events: Record<string, any> = {};
    for (const [event, target] of Object.entries(transitions)) {
      events[event] = { target };
    }
    return events;
  }

  private resolveTransition(transitions?: Record<string, string>): string | undefined {
    if (!transitions) return undefined;
    const keys = Object.keys(transitions);
    return keys.length > 0 ? transitions[keys[0]] : undefined;
  }

  start(services?: Record<string, any>, guards?: Record<string, any>): void {
    const machineWithConfig = this.machine.provide({
      actors: services || {},
      guards: guards || {},
      actions: {
        updateContext: ({ context, event }: any) => {
          if (event.output) {
            Object.assign(context.variables, event.output);
          }
        }
      }
    });

    this.actor = createActor(machineWithConfig);
    this.actor.start();
  }

  stop(): void {
    this.actor?.stop();
  }

  send(event: WorkflowEvent): void {
    this.actor?.send(event);
  }

  getState(): any {
    return this.actor?.getSnapshot();
  }

  onTransition(callback: (state: any) => void): void {
    this.actor?.subscribe(callback);
  }
}