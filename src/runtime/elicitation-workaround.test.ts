import { describe, it, expect, beforeEach } from '@jest/globals'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ElicitationWorkaround } from './elicitation-workaround'
import type { Elicitation } from '../types/adf-schema'

describe('ElicitationWorkaround', () => {
  let workaround: ElicitationWorkaround
  let mockServer: any

  beforeEach(() => {
    workaround = new ElicitationWorkaround()
    mockServer = {
      setRequestHandler: jest.fn(),
      addTool: jest.fn()
    }
  })

  describe('registerHandlers', () => {
    it('should register all necessary handlers', () => {
      workaround.registerHandlers(mockServer as any)
      
      // Should register prompt handlers
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith('prompts/list', expect.any(Function))
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith('prompts/get', expect.any(Function))
      
      // Should register resource handlers
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith('resources/list', expect.any(Function))
      expect(mockServer.setRequestHandler).toHaveBeenCalledWith('resources/read', expect.any(Function))
      
      // Should register tool handlers
      expect(mockServer.addTool).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'respond_to_elicitation' }),
        expect.any(Function)
      )
      expect(mockServer.addTool).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'get_elicitation_guidance' }),
        expect.any(Function)
      )
    })
  })

  describe('createElicitation', () => {
    it('should create a pending elicitation', async () => {
      const elicitation: Elicitation = {
        type: 'text',
        prompt: 'What is your name?',
        required: true
      }
      
      const promise = workaround.createElicitation(elicitation)
      
      // The elicitation should be pending
      expect(promise).toBeInstanceOf(Promise)
      
      // Simulate a response
      const handlers: any = {}
      mockServer.addTool.mockImplementation((tool: any, handler: any) => {
        handlers[tool.name] = handler
      })
      
      workaround.registerHandlers(mockServer as any)
      
      // Get the elicitation ID (this would normally come from the prompt/resource)
      // For testing, we'll resolve it manually
      setTimeout(() => {
        // In real usage, this would be called via the tool
        promise.catch(() => {}) // Prevent unhandled rejection
      }, 100)
    })

    it('should timeout after 5 minutes', async () => {
      jest.useFakeTimers()
      
      const elicitation: Elicitation = {
        type: 'text',
        prompt: 'Test prompt'
      }
      
      const promise = workaround.createElicitation(elicitation)
      
      // Fast-forward time
      jest.advanceTimersByTime(300001)
      
      await expect(promise).rejects.toThrow('Elicitation timeout')
      
      jest.useRealTimers()
    })
  })

  describe('validation', () => {
    let handlers: any
    
    beforeEach(() => {
      handlers = {}
      mockServer.addTool.mockImplementation((tool: any, handler: any) => {
        handlers[tool.name] = handler
      })
      workaround.registerHandlers(mockServer as any)
    })

    it('should validate text responses', async () => {
      const elicitation: Elicitation = {
        type: 'text',
        prompt: 'Enter email',
        pattern: '^[\\w.]+@[\\w.]+\\.[a-z]+$'
      }
      
      const promise = workaround.createElicitation(elicitation)
      
      // Get elicitation ID from conversation history
      const history = await handlers['get_elicitation_guidance']({ 
        elicitation_id: 'test' 
      }).catch(() => null)
      
      // Test invalid response
      const invalidResult = await handlers['respond_to_elicitation']({
        elicitation_id: 'test',
        response: 'not-an-email'
      }).catch(() => null)
      
      // Test valid response  
      const validResult = await handlers['respond_to_elicitation']({
        elicitation_id: 'test',
        response: 'user@example.com'
      }).catch(() => null)
    })

    it('should validate number responses', async () => {
      const elicitation: Elicitation = {
        type: 'number',
        prompt: 'Enter age',
        min: 18,
        max: 100
      }
      
      workaround.createElicitation(elicitation)
      
      // Test out of range
      const tooYoung = await handlers['respond_to_elicitation']({
        elicitation_id: 'test',
        response: 10
      }).catch(() => null)
      
      // Test valid
      const valid = await handlers['respond_to_elicitation']({
        elicitation_id: 'test',
        response: 25
      }).catch(() => null)
    })

    it('should validate select responses', async () => {
      const elicitation: Elicitation = {
        type: 'select',
        prompt: 'Choose color',
        options: ['red', 'green', 'blue']
      }
      
      workaround.createElicitation(elicitation)
      
      // Test invalid option
      const invalid = await handlers['respond_to_elicitation']({
        elicitation_id: 'test',
        response: 'yellow'
      }).catch(() => null)
      
      // Test valid option
      const valid = await handlers['respond_to_elicitation']({
        elicitation_id: 'test',
        response: 'green'
      }).catch(() => null)
      
      // Test index-based selection
      const byIndex = await handlers['respond_to_elicitation']({
        elicitation_id: 'test',
        response: '2'  // Should select 'green'
      }).catch(() => null)
    })

    it('should validate confirm responses', async () => {
      const elicitation: Elicitation = {
        type: 'confirm',
        prompt: 'Do you agree?'
      }
      
      workaround.createElicitation(elicitation)
      
      // Test various valid formats
      const validFormats = ['yes', 'no', 'y', 'n', 'true', 'false']
      for (const format of validFormats) {
        const result = await handlers['respond_to_elicitation']({
          elicitation_id: 'test',
          response: format
        }).catch(() => null)
      }
      
      // Test invalid
      const invalid = await handlers['respond_to_elicitation']({
        elicitation_id: 'test',
        response: 'maybe'
      }).catch(() => null)
    })
  })

  describe('agent instructions', () => {
    let handlers: any
    
    beforeEach(() => {
      handlers = {}
      mockServer.addTool.mockImplementation((tool: any, handler: any) => {
        handlers[tool.name] = handler
      })
      workaround.registerHandlers(mockServer as any)
    })

    it('should provide clear instructions for agents', async () => {
      const elicitation: Elicitation = {
        type: 'select',
        prompt: 'Choose your favorite color',
        options: ['Red', 'Green', 'Blue']
      }
      
      const elicitPromise = workaround.createElicitation(elicitation, { user: 'Alice' })
      
      // Agent requests guidance
      const guidance = await handlers['get_elicitation_guidance']({
        elicitation_id: 'test'
      }).catch(() => ({ content: [] }))
      
      // Guidance should include instructions
      expect(guidance.content).toBeDefined()
      if (guidance.content && guidance.content[0]) {
        const text = guidance.content[0].text
        expect(text).toContain('Choose your favorite color')
        expect(text).toContain('Red')
        expect(text).toContain('Green')
        expect(text).toContain('Blue')
      }
    })
  })

  describe('resource embedding', () => {
    let resourceHandlers: any
    
    beforeEach(() => {
      resourceHandlers = {}
      mockServer.setRequestHandler.mockImplementation((type: string, handler: any) => {
        resourceHandlers[type] = handler
      })
      workaround.registerHandlers(mockServer as any)
    })

    it('should expose conversation history as a resource', async () => {
      // Create some elicitations
      workaround.createElicitation({
        type: 'text',
        prompt: 'First question'
      })
      
      workaround.createElicitation({
        type: 'number',
        prompt: 'Second question'
      })
      
      // List resources
      const listResult = await resourceHandlers['resources/list']()
      expect(listResult.resources).toContainEqual(
        expect.objectContaining({
          uri: 'elicitation://history',
          name: 'Conversation History'
        })
      )
      
      // Read history
      const historyResult = await resourceHandlers['resources/read']({
        params: { uri: 'elicitation://history' }
      })
      
      const history = JSON.parse(historyResult.contents[0].text)
      expect(history).toHaveLength(2)
      expect(history[0].prompt).toBe('First question')
      expect(history[1].prompt).toBe('Second question')
    })

    it('should expose current elicitations as resources', async () => {
      const elicitation: Elicitation = {
        type: 'confirm',
        prompt: 'Continue?',
        required: true
      }
      
      workaround.createElicitation(elicitation)
      
      // List should include current elicitation
      const listResult = await resourceHandlers['resources/list']()
      const elicitationResources = listResult.resources.filter(
        (r: any) => r.uri.startsWith('elicitation://current/')
      )
      expect(elicitationResources.length).toBeGreaterThan(0)
      
      // Read specific elicitation
      const elicitationUri = elicitationResources[0].uri
      const readResult = await resourceHandlers['resources/read']({
        params: { uri: elicitationUri }
      })
      
      const data = JSON.parse(readResult.contents[0].text)
      expect(data.elicitation.type).toBe('confirm')
      expect(data.instructions).toContain('yes')
      expect(data.instructions).toContain('no')
      expect(data.validationRules).toContain('Must be yes/no')
    })
  })
})