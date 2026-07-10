declare module 'pg' {
  export interface PoolClient {
    query<T = any>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
    release(): void;
  }

  export class Pool {
    constructor(config?: { connectionString?: string });
    query<T = any>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
