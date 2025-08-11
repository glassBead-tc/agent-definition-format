#!/usr/bin/env node

import { Command } from 'commander'
import { ADFParser } from './parser/adf-parser.js'
import { ADFRuntime } from './runtime/adf-runtime.js'
import { ADFRuntimeWithFallback } from './runtime/adf-runtime-with-fallback.js'
import { ADFRuntimeEffect } from './effect/runtime/adf-runtime-effect.js'
import fs from 'fs/promises'
import winston from 'winston'

const program = new Command()
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [new winston.transports.Console()]
})

program
  .name('adf')
  .description('Agent Definition Format CLI - Run declarative MCP agents')
  .version('0.2.0')

program
  .command('run <file>')
  .description('Run an ADF agent from a YAML or JSON file')
  .option('-d, --debug', 'Enable debug logging')
  .option('-w, --watch', 'Watch for file changes and reload')
  .option('--effect', 'Use Effect-TS runtime (experimental)')
  .option('--fallback', 'Use runtime with elicitation fallback for all clients')
  .action(async (file, options) => {
    if (options.debug) {
      logger.level = 'debug'
      process.env.LOG_LEVEL = 'debug'
    }

    try {
      const parser = new ADFParser()
      logger.info(`Loading ADF from ${file}...`)
      
      const adf = await parser.parse(file)
      logger.info(`Successfully loaded agent: ${adf.agent.name}`)
      
      // Choose runtime based on flags
      let runtime: ADFRuntime | ADFRuntimeEffect | ADFRuntimeWithFallback
      
      if (options.effect) {
        logger.info('🚀 Using Effect-TS runtime (experimental)')
        runtime = new ADFRuntimeEffect(adf)
      } else if (options.fallback) {
        logger.info('🔄 Using runtime with elicitation fallback')
        runtime = new ADFRuntimeWithFallback(adf)
      } else {
        runtime = new ADFRuntime(adf)
      }
      
      process.on('SIGINT', async () => {
        logger.info('Shutting down...')
        await runtime.stop()
        process.exit(0)
      })

      await runtime.start()
      
      if (options.watch) {
        logger.info('Watching for changes...')
        const watcher = setInterval(async () => {
          try {
            const newAdf = await parser.parse(file)
            if (JSON.stringify(newAdf) !== JSON.stringify(adf)) {
              logger.info('ADF changed, reloading...')
              await runtime.stop()
              
              if (options.effect) {
                runtime = new ADFRuntimeEffect(newAdf)
              } else if (options.fallback) {
                runtime = new ADFRuntimeWithFallback(newAdf)
              } else {
                runtime = new ADFRuntime(newAdf)
              }
              
              await runtime.start()
            }
          } catch (error) {
            logger.error('Failed to reload:', error)
          }
        }, 2000)
        
        process.on('SIGINT', () => clearInterval(watcher))
      }
    } catch (error) {
      logger.error('Failed to run ADF:', error)
      process.exit(1)
    }
  })

program
  .command('validate <file>')
  .description('Validate an ADF file without running it')
  .action(async (file) => {
    try {
      const parser = new ADFParser()
      const result = await parser.validateFile(file)
      
      if (result.valid) {
        logger.info('✅ ADF is valid')
      } else {
        logger.error('❌ ADF validation failed:')
        result.errors?.forEach(error => logger.error(error))
        process.exit(1)
      }
    } catch (error) {
      logger.error('Validation error:', error)
      process.exit(1)
    }
  })

program
  .command('init <name>')
  .description('Create a new ADF template')
  .option('-t, --type <type>', 'Template type (basic, workflow, full, effect, fallback)', 'basic')
  .action(async (name, options) => {
    const template = getTemplate(options.type, name)
    const fileName = `${name}.yaml`
    
    try {
      await fs.writeFile(fileName, template)
      logger.info(`✅ Created ${fileName}`)
      logger.info('Edit the file and run with: adf run ' + fileName)
      
      if (options.type === 'effect') {
        logger.info('💡 Use --effect flag to run with Effect-TS runtime')
      } else if (options.type === 'fallback') {
        logger.info('💡 Use --fallback flag to run with elicitation fallback support')
      }
    } catch (error) {
      logger.error('Failed to create template:', error)
      process.exit(1)
    }
  })

function getTemplate(type: string, name: string): string {
  const templates: Record<string, string> = {
    basic: `version: "1.0"
agent:
  name: "${name}"
  description: "A basic MCP agent"
  
  capabilities:
    tools: true
    
  tools:
    - name: "hello"
      description: "Say hello"
      parameters:
        name:
          type: "string"
          description: "Name to greet"
          required: true
      handler: "handlers.hello"
    
  workflows:
    main:
      initial: "start"
      states:
        start:
          type: "response"
          template: "Agent ${name} is ready"
`,

    effect: `version: "1.0"
agent:
  name: "${name}"
  description: "An Effect-TS powered MCP agent"
  
  capabilities:
    tools: true
    resources: true
    
  tools:
    - name: "process"
      description: "Process data with Effect"
      parameters:
        data:
          type: "object"
          required: true
      handler: "handlers.process"
      
  resources:
    - uri: "/status"
      description: "Agent status"
      handler: "handlers.status"
    
  workflows:
    main:
      initial: "start"
      states:
        start:
          type: "response"
          template: "Effect-powered agent ${name} is ready"
          
  handlers:
    path: "./handlers"
    runtime: "typescript"
`,

    workflow: `version: "1.0"
agent:
  name: "${name}"
  description: "An agent with workflow capabilities"
  
  capabilities:
    sampling: true
    elicitation: true
    
  workflows:
    main:
      initial: "greeting"
      
      states:
        greeting:
          type: "elicitation"
          prompt: "How can I help you today?"
          elicitation:
            type: "select"
            prompt: "Please choose an option:"
            options: ["Option A", "Option B", "Help"]
          transitions:
            "Option A": "process_a"
            "Option B": "process_b"
            "Help": "show_help"
            
        process_a:
          type: "sampling"
          prompt: "Processing Option A..."
          transitions:
            default: "complete"
            
        process_b:
          type: "sampling"
          prompt: "Processing Option B..."
          transitions:
            default: "complete"
            
        show_help:
          type: "response"
          template: "Here are the available options..."
          
        complete:
          type: "response"
          template: "Task completed successfully"
`,

    full: `version: "1.0"
agent:
  name: "${name}"
  description: "A full-featured MCP agent"
  
  capabilities:
    sampling: true
    elicitation: true
    tools: true
    resources: true
    
  tools:
    - name: "process_data"
      description: "Process input data"
      parameters:
        data:
          type: "object"
          description: "Data to process"
          required: true
      handler: "handlers.processData"
    
  resources:
    - uri: "/status"
      description: "Agent status information"
      handler: "handlers.getStatus"
    
  workflows:
    main:
      initial: "init"
      
      states:
        init:
          type: "conditional"
          condition: "has_context"
          onTrue: "analyze"
          onFalse: "gather_info"
          
        gather_info:
          type: "elicitation"
          prompt: "I need some information to proceed"
          elicitation:
            type: "text"
            prompt: "Please provide context:"
          transitions:
            default: "analyze"
            
        analyze:
          type: "sampling"
          prompt: "Analyzing the provided information..."
          context: ["user_input", "system_state"]
          transitions:
            success: "execute"
            error: "handle_error"
            
        execute:
          type: "tool"
          tool: "process_data"
          transitions:
            default: "report"
            
        handle_error:
          type: "response"
          template: "An error occurred: {error_message}"
          
        report:
          type: "response"
          template: "Processing complete. Results: {results}"
          
  handlers:
    path: "./handlers"
    runtime: "typescript"
`,

    fallback: `version: "1.0"
agent:
  name: "${name}"
  description: "Agent with elicitation fallback support"
  
  capabilities:
    elicitation: true
    sampling: true
    tools: true
    resources: true
    
  tools:
    - name: "collect_info"
      description: "Process collected information"
      parameters:
        data:
          type: "object"
          required: true
      handler: "handlers.collectInfo"
    
  resources:
    - uri: "/conversation/history"
      description: "Conversation history with fallback support"
      handler: "handlers.getHistory"
    
  workflows:
    interactive:
      initial: "welcome"
      
      states:
        welcome:
          type: "response"
          template: "Welcome! This agent works with or without elicitation support."
          transitions:
            default: "get_input"
            
        get_input:
          type: "elicitation"
          prompt: "What would you like to do?"
          elicitation:
            type: "select"
            prompt: "Please choose an option"
            options: ["Process Data", "Get Information", "Configure Settings", "Exit"]
            required: true
          transitions:
            "Process Data": "process"
            "Get Information": "info"
            "Configure Settings": "configure"
            "Exit": "goodbye"
            
        process:
          type: "tool"
          tool: "collect_info"
          transitions:
            default: "complete"
            
        info:
          type: "sampling"
          prompt: "Retrieving information..."
          transitions:
            default: "complete"
            
        configure:
          type: "elicitation"
          prompt: "Enter configuration value"
          elicitation:
            type: "text"
            prompt: "Please provide configuration"
            pattern: "^[A-Za-z0-9_]+$"
          transitions:
            default: "complete"
            
        complete:
          type: "response"
          template: "Task completed successfully!"
          transitions:
            default: "get_input"
            
        goodbye:
          type: "response"
          template: "Thank you for using ${name}. Goodbye!"
          
  handlers:
    path: "./handlers"
    runtime: "typescript"
`
  }

  return templates[type] || templates.basic
}

program.parse(process.argv)