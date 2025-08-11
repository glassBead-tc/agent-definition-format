import Anthropic from '@anthropic-ai/sdk';

export class SamplingService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || 'mock-key'
    });
  }

  async execute(config: any, context: Record<string, any>): Promise<any> {
    const { prompt, context: contextKeys = [] } = config;
    
    // Build context string from specified keys
    const contextData = contextKeys
      .map((key: string) => `${key}: ${JSON.stringify(context[key], null, 2)}`)
      .join('\n\n');

    const fullPrompt = contextData 
      ? `${prompt}\n\nContext:\n${contextData}`
      : prompt;

    try {
      // In production, this would make a real API call
      if (process.env.ANTHROPIC_API_KEY && process.env.NODE_ENV !== 'test') {
        const response = await this.anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1024,
          messages: [
            { role: 'user', content: fullPrompt }
          ]
        });

        const content = response.content[0];
        if (content.type === 'text') {
          return { result: content.text };
        }
      }

      // Mock response for testing/development
      return {
        result: `Analyzed: ${prompt.substring(0, 50)}...`,
        context: contextKeys
      };
    } catch (error) {
      console.error('Sampling error:', error);
      return {
        result: 'Sampling completed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}