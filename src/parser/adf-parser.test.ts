import { ADFParser } from './adf-parser';
import { describe, it, expect, beforeEach } from '@jest/globals';

describe('ADFParser', () => {
  let parser: ADFParser;

  beforeEach(() => {
    parser = new ADFParser();
  });

  describe('parseString', () => {
    it('should parse valid YAML', () => {
      const yaml = `
version: "1.0"
agent:
  name: "test-agent"
  description: "Test agent"
  workflows:
    main:
      initial: "start"
      states:
        start:
          type: "response"
          template: "Hello"
`;
      const result = parser.parseString(yaml, 'yaml');
      expect(result.agent.name).toBe('test-agent');
      expect(result.agent.workflows.main.initial).toBe('start');
    });

    it('should parse valid JSON', () => {
      const json = JSON.stringify({
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
                  template: "Hello"
                }
              }
            }
          }
        }
      });
      
      const result = parser.parseString(json, 'json');
      expect(result.agent.name).toBe('test-agent');
    });

    it('should validate required fields', () => {
      const invalid = `
version: "1.0"
agent:
  description: "Missing name"
`;
      expect(() => parser.parseString(invalid)).toThrow();
    });

    it('should validate state types', () => {
      const yaml = `
version: "1.0"
agent:
  name: "test"
  description: "Test"
  workflows:
    main:
      initial: "start"
      states:
        start:
          type: "invalid_type"
`;
      expect(() => parser.parseString(yaml)).toThrow();
    });
  });

  describe('complex workflows', () => {
    it('should parse elicitation states', () => {
      const yaml = `
version: "1.0"
agent:
  name: "test"
  description: "Test"
  capabilities:
    elicitation: true
  workflows:
    main:
      initial: "ask"
      states:
        ask:
          type: "elicitation"
          elicitation:
            type: "select"
            prompt: "Choose"
            options: ["A", "B"]
          transitions:
            A: "process_a"
            B: "process_b"
        process_a:
          type: "response"
          template: "A selected"
        process_b:
          type: "response"
          template: "B selected"
`;
      const result = parser.parseString(yaml);
      expect(result.agent.workflows.main.states.ask.type).toBe('elicitation');
      expect(result.agent.workflows.main.states.ask.elicitation?.type).toBe('select');
    });

    it('should parse tool definitions', () => {
      const yaml = `
version: "1.0"
agent:
  name: "test"
  description: "Test"
  tools:
    - name: "my_tool"
      description: "Test tool"
      parameters:
        input:
          type: "string"
          required: true
      handler: "handlers.myTool"
  workflows:
    main:
      initial: "use_tool"
      states:
        use_tool:
          type: "tool"
          tool: "my_tool"
`;
      const result = parser.parseString(yaml);
      expect(result.agent.tools).toHaveLength(1);
      expect(result.agent.tools![0].name).toBe('my_tool');
    });
  });
});