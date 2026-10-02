import { z } from 'zod';

export const APP_MODES = ['all', 'api', 'redirect'] as const;
export type AppMode = (typeof APP_MODES)[number];

/**
 * Value passed to Fastify's `trustProxy` option. Hop counts are not supported:
 * Fastify treats them as "trust nobody" because they cannot verify the peer.
 */
export type TrustProxy = boolean | string[];

const trustProxySchema = z
  .string()
  .default('false')
  .transform((raw, ctx): TrustProxy => {
    const value = raw.trim().toLowerCase();
    if (value === 'false') return false;
    if (value === 'true') return true;
    if (/^\d+$/.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'hop counts are not supported; use true or a list of proxy IPs/CIDRs',
      });
      return z.NEVER;
    }
    // Comma-separated list of IPs/CIDRs (proxy-addr syntax).
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  });

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// connection string'),
  BASE_URL: z.url({ protocol: /^https?$/ }).transform((v) => v.replace(/\/+$/, '')),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_MODE: z.enum(APP_MODES).default('all'),
  TRUST_PROXY: trustProxySchema,
  CLICK_FLUSH_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate configuration from environment variables.
 * Empty strings are treated as unset so `.env` placeholders fall back to defaults.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Load `.env` from the working directory if present (local development convenience). */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
