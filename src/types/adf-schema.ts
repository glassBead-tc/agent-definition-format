import { z } from 'zod';

export const ParameterSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.any().optional(),
  enum: z.array(z.any()).optional(),
});

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(ParameterSchema).optional(),
  handler: z.string(),
});

export const ResourceSchema = z.object({
  uri: z.string(),
  description: z.string(),
  handler: z.string().optional(),
});

export const ElicitationSchema = z.object({
  type: z.enum(['confirm', 'select', 'text', 'number']),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  schema: z.any().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  required: z.boolean().optional(),
});

export const SamplingSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  system: z.string().optional(),
  context: z.array(z.string()).optional(),
});

export const TransitionSchema = z.record(z.string());

export const StateSchema = z.object({
  type: z.enum(['elicitation', 'sampling', 'response', 'tool', 'conditional', 'parallel', 'loop']),
  prompt: z.string().optional(),
  elicitation: ElicitationSchema.optional(),
  sampling: SamplingSchema.optional(),
  context: z.array(z.string()).optional(),
  transitions: TransitionSchema.optional(),
  template: z.string().optional(),
  tool: z.string().optional(),
  parameters: z.record(z.any()).optional(),
  handler: z.string().optional(),
  condition: z.string().optional(),
  onTrue: z.string().optional(),
  onFalse: z.string().optional(),
  branches: z.array(z.string()).optional(),
  body: z.string().optional(),
  maxIterations: z.number().optional(),
});

export const WorkflowSchema = z.object({
  initial: z.string(),
  states: z.record(StateSchema),
  maxSteps: z.number().optional(),
});

export const CapabilitiesSchema = z.object({
  sampling: z.boolean().optional(),
  elicitation: z.boolean().optional(),
  tools: z.boolean().optional(),
  resources: z.boolean().optional(),
});

export const HandlersSchema = z.object({
  path: z.string(),
  runtime: z.enum(['typescript', 'python']).optional(),
});

export const AgentSchema = z.object({
  name: z.string(),
  description: z.string(),
  capabilities: CapabilitiesSchema.optional(),
  tools: z.array(ToolSchema).optional(),
  resources: z.array(ResourceSchema).optional(),
  workflows: z.record(WorkflowSchema),
  handlers: HandlersSchema.optional(),
  context: z.record(z.any()).optional(),
});

export const ADFSchema = z.object({
  version: z.string(),
  agent: AgentSchema,
});

export type ADF = z.infer<typeof ADFSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type State = z.infer<typeof StateSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Elicitation = z.infer<typeof ElicitationSchema>;
export type Sampling = z.infer<typeof SamplingSchema>;