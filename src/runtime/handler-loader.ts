import path from 'path';
import { pathToFileURL } from 'url';

export type ToolHandler = (args: any) => Promise<any>;
export type ResourceHandler = (uri: string) => Promise<any>;

export class HandlerLoader {
  private cache = new Map<string, any>();

  constructor(private basePath: string) {}

  async loadToolHandler(handlerPath: string): Promise<ToolHandler> {
    return this.loadHandler(handlerPath);
  }

  async loadResourceHandler(handlerPath: string): Promise<ResourceHandler> {
    return this.loadHandler(handlerPath);
  }

  private async loadHandler(handlerPath: string): Promise<any> {
    if (this.cache.has(handlerPath)) {
      return this.cache.get(handlerPath);
    }

    try {
      const fullPath = path.isAbsolute(handlerPath) 
        ? handlerPath 
        : path.join(process.cwd(), this.basePath, handlerPath);

      const modulePath = fullPath.endsWith('.js') || fullPath.endsWith('.ts')
        ? fullPath
        : `${fullPath}.js`;

      const moduleUrl = pathToFileURL(modulePath).href;
      const module = await import(moduleUrl);
      
      const handler = module.default || module.handler || module;
      
      if (typeof handler !== 'function') {
        throw new Error(`Handler at ${handlerPath} is not a function`);
      }

      this.cache.set(handlerPath, handler);
      return handler;
    } catch (error) {
      // If custom handler fails, return a default handler
      console.warn(`Failed to load handler ${handlerPath}, using default:`, error);
      
      const defaultHandler = async (args: any) => ({
        success: true,
        message: `Handler ${handlerPath} executed`,
        args
      });
      
      this.cache.set(handlerPath, defaultHandler);
      return defaultHandler;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}