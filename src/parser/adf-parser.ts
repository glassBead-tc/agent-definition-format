import yaml from 'js-yaml';
import fs from 'fs/promises';
import path from 'path';
import { ADFSchema, type ADF } from '../types/adf-schema.js';
import { z } from 'zod';

export class ADFParser {
  async parse(filePath: string): Promise<ADF> {
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    
    let data: unknown;
    if (ext === '.yaml' || ext === '.yml') {
      data = yaml.load(content);
    } else if (ext === '.json') {
      data = JSON.parse(content);
    } else {
      throw new Error(`Unsupported file format: ${ext}. Use .yaml, .yml, or .json`);
    }
    
    return this.validate(data);
  }

  parseString(content: string, format: 'yaml' | 'json' = 'yaml'): ADF {
    let data: unknown;
    if (format === 'yaml') {
      data = yaml.load(content);
    } else {
      data = JSON.parse(content);
    }
    
    return this.validate(data);
  }

  private validate(data: unknown): ADF {
    try {
      return ADFSchema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(issue => 
          `  - ${issue.path.join('.')}: ${issue.message}`
        ).join('\n');
        throw new Error(`ADF validation failed:\n${issues}`);
      }
      throw error;
    }
  }

  async validateFile(filePath: string): Promise<{ valid: boolean; errors?: string[] }> {
    try {
      await this.parse(filePath);
      return { valid: true };
    } catch (error) {
      if (error instanceof Error) {
        return {
          valid: false,
          errors: error.message.split('\n').filter(line => line.trim())
        };
      }
      return { valid: false, errors: ['Unknown validation error'] };
    }
  }
}