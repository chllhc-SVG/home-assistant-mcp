declare module 'pg' {
  export class Pool {
    constructor(config?: { connectionString?: string });
    query<T = any>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
    end(): Promise<void>;
  }
}
