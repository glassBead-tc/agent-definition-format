import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CreateMessageRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ADF } from '../types/adf-schema.js';
import { WorkflowStateMachine } from './state-machine.js';
import { HandlerLoader } from './handler-loader.js';
import { ElicitationService } from './elicitation-service.js';
import { SamplingService } from './sampling-service.js';
import winston from 'winston';

export class ADFRuntime {
  private server: Server;
  private adf: ADF;
  private stateMachine?: WorkflowStateMachine;
  private handlerLoader: HandlerLoader;
  private elicitationService: ElicitationService;
  private samplingService: SamplingService;
  private logger: winston.Logger;

  constructor(adf: ADF) {
    this.adf = adf;
    this.server = new Server(
      {
        name: adf.agent.name,
        version: adf.version,
      },
      {
        capabilities: {
          tools: adf.agent.capabilities?.tools !== false && (adf.agent.tools?.length ?? 0) > 0 ? {} : undefined,
          resources: adf.agent.capabilities?.resources !== false && (adf.agent.resources?.length ?? 0) > 0 ? {} : undefined,
          prompts: adf.agent.capabilities?.sampling !== false ? {} : undefined,
        },
      }
    );

    this.handlerLoader = new HandlerLoader(adf.agent.handlers?.path || './handlers');
    this.elicitationService = new ElicitationService();
    this.samplingService = new SamplingService();
    
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Tools handler
    if (this.adf.agent.tools) {
      this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: this.adf.agent.tools!.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: 'object',
            properties: tool.parameters || {},
            required: Object.entries(tool.parameters || {})
              .filter(([_, param]) => param.required)
              .map(([name]) => name)
          }
        }))
      }));

      this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = this.adf.agent.tools!.find(t => t.name === request.params.name);
        if (!tool) {
          throw new Error(`Tool ${request.params.name} not found`);
        }

        try {
          const handler = await this.handlerLoader.loadToolHandler(tool.handler);
          const result = await handler(request.params.arguments);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (error) {
          this.logger.error(`Tool execution failed: ${error}`);
          throw error;
        }
      });
    }

    // Resources handler
    if (this.adf.agent.resources) {
      this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: this.adf.agent.resources!.map(resource => ({
          uri: resource.uri,
          description: resource.description,
          mimeType: 'application/json'
        }))
      }));

      this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const resource = this.adf.agent.resources!.find(r => r.uri === request.params.uri);
        if (!resource) {
          throw new Error(`Resource ${request.params.uri} not found`);
        }

        if (resource.handler) {
          const handler = await this.handlerLoader.loadResourceHandler(resource.handler);
          const content = await handler(request.params.uri);
          
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(content, null, 2)
              }
            ]
          };
        }

        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'application/json',
              text: JSON.stringify({ message: 'Static resource' }, null, 2)
            }
          ]
        };
      });
    }

    // Prompts/Sampling handler
    if (this.adf.agent.capabilities?.sampling) {
      this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
        const prompts = [];
        
        for (const [workflowName, workflow] of Object.entries(this.adf.agent.workflows)) {
          for (const [stateName, state] of Object.entries(workflow.states)) {
            if (state.type === 'sampling' && state.prompt) {
              prompts.push({
                name: `${workflowName}.${stateName}`,
                description: state.prompt.substring(0, 100)
              });
            }
          }
        }
        
        return { prompts };
      });

      this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const [workflowName, stateName] = request.params.name.split('.');
        const workflow = this.adf.agent.workflows[workflowName];
        const state = workflow?.states[stateName];
        
        if (!state || state.type !== 'sampling') {
          throw new Error(`Prompt ${request.params.name} not found`);
        }

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: state.prompt || ''
              }
            }
          ]
        };
      });
    }

    // Message creation handler for elicitation
    if (this.adf.agent.capabilities?.elicitation) {
      this.server.setRequestHandler(CreateMessageRequestSchema, async (request) => {
        const response = await this.elicitationService.handleElicitation(request);
        return response;
      });
    }
  }

  async start(transport?: StdioServerTransport): Promise<void> {
    const activeTransport = transport || new StdioServerTransport();
    
    this.logger.info(`Starting ADF Runtime for agent: ${this.adf.agent.name}`);
    
    await this.server.connect(activeTransport);
    
    // Initialize default workflow if specified
    const defaultWorkflow = Object.keys(this.adf.agent.workflows)[0];
    if (defaultWorkflow) {
      this.stateMachine = new WorkflowStateMachine(this.adf, defaultWorkflow);
      
      // Set up state machine services
      const services = {
        elicitation: async (_context: any, event: any) => {
          return this.elicitationService.execute(event.data.config);
        },
        sampling: async (context: any, event: any) => {
          return this.samplingService.execute(event.data.config, context.variables);
        },
        executeTool: async (context: any, event: any) => {
          const tool = this.adf.agent.tools?.find(t => t.name === event.data.toolName);
          if (!tool) {
            throw new Error(`Tool ${event.data.toolName} not found`);
          }
          const handler = await this.handlerLoader.loadToolHandler(tool.handler);
          return handler(context.variables);
        }
      };

      const guards = {
        evaluateCondition: (context: any, _event: any, { cond }: any) => {
          // Simple condition evaluation - can be enhanced
          return Boolean(context.variables[cond.condition]);
        }
      };

      this.stateMachine.start(services, guards);
      
      this.stateMachine.onTransition((state) => {
        this.logger.debug(`State transition: ${JSON.stringify(state.value)}`);
      });
    }
    
    this.logger.info('ADF Runtime started successfully');
  }

  async stop(): Promise<void> {
    this.stateMachine?.stop();
    await this.server.close();
    this.logger.info('ADF Runtime stopped');
  }
}