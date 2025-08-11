import { WorkflowStateMachine } from './state-machine';
import type { ADF } from '../types/adf-schema';
import { describe, it, expect, beforeEach } from '@jest/globals';

describe('WorkflowStateMachine', () => {
  let testADF: ADF;

  beforeEach(() => {
    testADF = {
      version: "1.0",
      agent: {
        name: "test-agent",
        description: "Test agent",
        workflows: {
          main: {
            initial: "start",
            states: {
              start: {
                type: "response",
                template: "Starting"
              }
            }
          }
        }
      }
    };
  });

  it('should create state machine from ADF', () => {
    const stateMachine = new WorkflowStateMachine(testADF, 'main');
    expect(stateMachine).toBeDefined();
  });

  it('should throw error for non-existent workflow', () => {
    expect(() => new WorkflowStateMachine(testADF, 'invalid')).toThrow();
  });

  it('should build complex workflows', () => {
    testADF.agent.workflows.main = {
      initial: "greeting",
      states: {
        greeting: {
          type: "elicitation",
          elicitation: {
            type: "select",
            prompt: "Choose",
            options: ["A", "B"]
          },
          transitions: {
            A: "process_a",
            B: "process_b"
          }
        },
        process_a: {
          type: "response",
          template: "A"
        },
        process_b: {
          type: "response",
          template: "B"
        }
      }
    };

    const stateMachine = new WorkflowStateMachine(testADF, 'main');
    expect(stateMachine).toBeDefined();
  });

  it('should handle conditional states', () => {
    testADF.agent.workflows.main = {
      initial: "check",
      states: {
        check: {
          type: "conditional",
          condition: "hasData",
          onTrue: "yes",
          onFalse: "no"
        },
        yes: {
          type: "response",
          template: "Has data"
        },
        no: {
          type: "response",
          template: "No data"
        }
      }
    };

    const stateMachine = new WorkflowStateMachine(testADF, 'main');
    expect(stateMachine).toBeDefined();
  });
});