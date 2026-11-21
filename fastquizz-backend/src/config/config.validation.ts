import * as Joi from 'joi';

/**
 * Environment configuration validation schema.
 * Fails fast at startup if required variables are missing or invalid.
 */
export const configValidationSchema = Joi.object({
  // Database
  DATABASE_URL: Joi.string().uri().required().messages({
    'string.base': 'DATABASE_URL must be a string',
    'string.uri': 'DATABASE_URL must be a valid PostgreSQL connection URI',
    'any.required': 'DATABASE_URL is required',
  }),

  // Redis (Upstash)
  UPSTASH_REDIS_URL: Joi.string().uri().required().messages({
    'string.base': 'UPSTASH_REDIS_URL must be a string',
    'string.uri': 'UPSTASH_REDIS_URL must be a valid Redis connection URI (e.g., rediss://...)',
    'any.required': 'UPSTASH_REDIS_URL is required',
  }),

  // JWT
  JWT_SECRET: Joi.string().min(32).required().messages({
    'string.base': 'JWT_SECRET must be a string',
    'string.min': 'JWT_SECRET must be at least 32 characters long',
    'any.required': 'JWT_SECRET is required',
  }),
  JWT_EXPIRES_IN: Joi.string().default('7d').messages({
    'string.base': 'JWT_EXPIRES_IN must be a string',
  }),

  // App
  PORT: Joi.number().port().default(3000).messages({
    'number.base': 'PORT must be a number',
    'number.port': 'PORT must be a valid port number (1-65535)',
  }),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development').messages({
    'string.base': 'NODE_ENV must be a string',
    'any.only': 'NODE_ENV must be one of: development, production, test',
  }),
  FRONTEND_URL: Joi.string().uri().required().messages({
    'string.base': 'FRONTEND_URL must be a string',
    'string.uri': 'FRONTEND_URL must be a valid URL',
    'any.required': 'FRONTEND_URL is required',
  }),

  // Redis (legacy - optional if UPSTASH_REDIS_URL is used)
  REDIS_HOST: Joi.string().default('localhost').messages({
    'string.base': 'REDIS_HOST must be a string',
  }),
  REDIS_PORT: Joi.number().port().default(6379).messages({
    'number.base': 'REDIS_PORT must be a number',
    'number.port': 'REDIS_PORT must be a valid port number',
  }),
  REDIS_PASSWORD: Joi.string().allow('').optional().messages({
    'string.base': 'REDIS_PASSWORD must be a string',
  }),
  REDIS_DB: Joi.number().integer().min(0).default(0).messages({
    'number.base': 'REDIS_DB must be a number',
    'number.min': 'REDIS_DB must be a non-negative integer',
  }),
})
  .unknown(true) // Allow additional env vars not in schema
  .required();