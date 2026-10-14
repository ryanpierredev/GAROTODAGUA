import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// Timestamp and COUNT(*) bigint values must remain safe JavaScript numbers.
export function createPool() {
  return new Pool({
    max: 10,
    connectionTimeoutMillis: 5000,
    types: {
      getTypeParser(oid, format) {
        if (oid === 20 && format !== 'binary')
          return (value: string) => {
            const number = Number(value);
            if (!Number.isSafeInteger(number))
              throw new Error('Inteiro fora do limite seguro.');
            return number;
          };
        return types.getTypeParser(oid, format);
      },
    },
  });
}

export class Statement {
  private pool: Pool;
  readonly sql: string;
  readonly values: unknown[];
  constructor(pool: Pool, sql: string, values: unknown[] = []) {
    this.pool = pool;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new Statement(this.pool, this.sql, values);
  }

  async execute(client: Pool | PoolClient = this.pool) {
    const result = await client.query(this.sql, this.values);
    return {
      results: result.rows,
      meta: {
        changes: result.rowCount ?? 0,
        last_row_id: result.rows[0]?.id as number | undefined,
      },
    };
  }

  async first<T = QueryResultRow>(): Promise<T | null> {
    return ((await this.execute()).results[0] as T | undefined) ?? null;
  }

  all() {
    return this.execute();
  }
  run() {
    return this.execute();
  }
}

export class Database {
  private pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  prepare(sql: string) {
    return new Statement(this.pool, sql);
  }

  // All statements share a connection and commit or roll back together.
  async batch(statements: Statement[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const statement of statements)
        results.push(await statement.execute(client));
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
