/**
 * Billing system error handling and validation utilities
 */

export class BillingError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export class InsufficientFundsError extends BillingError {
  constructor(required: number, available: number) {
    super(
      `Insufficient funds: required $${(required / 100).toFixed(
        2
      )}, available $${(available / 100).toFixed(2)}`,
      "INSUFFICIENT_FUNDS",
      402,
      { required, available }
    );
  }
}

export class InvalidTokenPriceError extends BillingError {
  constructor(modelId: string) {
    super(
      `No token price configured for model: ${modelId}`,
      "INVALID_TOKEN_PRICE",
      404,
      { modelId }
    );
  }
}

export class DuplicateOperationError extends BillingError {
  constructor(idempotencyKey: string, operationType: string) {
    super(
      `Duplicate operation detected: ${operationType} with key ${idempotencyKey}`,
      "DUPLICATE_OPERATION",
      409,
      { idempotencyKey, operationType }
    );
  }
}

export class UserNotFoundError extends BillingError {
  constructor(userId: string) {
    super(`User not found: ${userId}`, "USER_NOT_FOUND", 404, { userId });
  }
}

export class PaymentProcessingError extends BillingError {
  constructor(paymentReference: string, originalError?: Error) {
    super(
      `Payment processing failed: ${paymentReference}`,
      "PAYMENT_PROCESSING_ERROR",
      500,
      { paymentReference, originalError: originalError?.message }
    );
  }
}

/**
 * Input validation utilities
 */
export const validators = {
  amountCents: (amount: number): void => {
    if (!Number.isInteger(amount)) {
      throw new BillingError(
        "Amount must be an integer (cents)",
        "INVALID_AMOUNT"
      );
    }
    if (amount < 0) {
      throw new BillingError("Amount cannot be negative", "INVALID_AMOUNT");
    }
    if (amount > 100_000_000) {
      // $1M limit
      throw new BillingError(
        "Amount exceeds maximum limit",
        "AMOUNT_TOO_LARGE"
      );
    }
  },

  tokensUsed: (tokens: number): void => {
    if (!Number.isInteger(tokens) || tokens <= 0) {
      throw new BillingError(
        "Tokens used must be a positive integer",
        "INVALID_TOKENS"
      );
    }
    if (tokens > 10_000_000) {
      // 10M token limit per call
      throw new BillingError(
        "Token count exceeds maximum limit",
        "TOKENS_TOO_LARGE"
      );
    }
  },

  modelId: (modelId: string): void => {
    if (!modelId || typeof modelId !== "string") {
      throw new BillingError("Model ID is required", "INVALID_MODEL_ID");
    }
    if (modelId.length > 100) {
      throw new BillingError("Model ID too long", "INVALID_MODEL_ID");
    }
  },

  userId: (userId: string): void => {
    if (!userId || typeof userId !== "string") {
      throw new BillingError("User ID is required", "INVALID_USER_ID");
    }
  },

  idempotencyKey: (key?: string): void => {
    if (key && (typeof key !== "string" || key.length > 255)) {
      throw new BillingError(
        "Invalid idempotency key",
        "INVALID_IDEMPOTENCY_KEY"
      );
    }
  },

  priceMicroCents: (price: number): void => {
    if (!Number.isInteger(price) || price < 0) {
      throw new BillingError(
        "Price must be a non-negative integer",
        "INVALID_PRICE"
      );
    }
    if (price > 100_000_000_000) {
      // $1000/token max (1000 dollars * 100 cents * 1_000_000 micro-cents)
      throw new BillingError("Price exceeds maximum limit", "PRICE_TOO_LARGE");
    }
  },
};

/**
 * Execute an async operation and normalize any non-BillingError into a BillingError.
 *
 * If the operation throws a BillingError it is rethrown unchanged. Any other thrown value
 * is wrapped in a new BillingError with code `INTERNAL_ERROR`, statusCode `500`, and
 * metadata containing the original error message under `originalError`.
 *
 * @param operation - Async function to execute.
 * @param errorContext - Short context string included in the wrapped error message.
 * @returns The resolved value of `operation`.
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  errorContext: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BillingError) {
      throw error;
    }

    // Convert unknown errors to BillingError
    throw new BillingError(
      `${errorContext}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      "INTERNAL_ERROR",
      500,
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Rate limiting helper
 */
export class RateLimiter {
  private attempts: Map<string, { count: number; resetTime: number }> =
    new Map();

  isAllowed(key: string, maxAttempts: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.attempts.get(key);

    if (!entry || now > entry.resetTime) {
      // Reset or first attempt
      this.attempts.set(key, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (entry.count >= maxAttempts) {
      return false;
    }

    entry.count++;
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts.entries()) {
      if (now > entry.resetTime) {
        this.attempts.delete(key);
      }
    }
  }
}

/**
 * Logging utilities
 */
export const BillingLogger = {
  info: (message: string, metadata?: Record<string, any>) => {
    console.log(
      `[BILLING] ${message}`,
      metadata ? JSON.stringify(metadata) : ""
    );
  },

  warn: (message: string, metadata?: Record<string, any>) => {
    console.warn(
      `[BILLING] ${message}`,
      metadata ? JSON.stringify(metadata) : ""
    );
  },

  error: (message: string, error?: Error, metadata?: Record<string, any>) => {
    console.error(`[BILLING] ${message}`, {
      error: error?.message,
      stack: error?.stack,
      ...metadata,
    });
  },

  transaction: (
    type: string,
    userId: string,
    amount: number,
    metadata?: Record<string, any>
  ) => {
    console.log(`[BILLING_TRANSACTION] ${type}`, {
      userId,
      amountCents: amount,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  },
};

/**
 * Monitoring utilities
 */
export class BillingMetrics {
  private static metrics: Map<string, number> = new Map();

  static increment(metric: string, value: number = 1): void {
    const current = this.metrics.get(metric) || 0;
    this.metrics.set(metric, current + value);
  }

  static get(metric: string): number {
    return this.metrics.get(metric) || 0;
  }

  static getAll(): Record<string, number> {
    return Object.fromEntries(this.metrics.entries());
  }

  static reset(): void {
    this.metrics.clear();
  }
}

// Pre-defined metrics
export const METRICS = {
  SIGNUP_CREDITS_AWARDED: "billing.signup_credits_awarded",
  TOPUP_BONUSES_AWARDED: "billing.topup_bonuses_awarded",
  MODEL_CALLS_CHARGED: "billing.model_calls_charged",
  MODEL_CALLS_FAILED_INSUFFICIENT_FUNDS:
    "billing.model_calls_failed_insufficient_funds",
  PAYMENT_INTENTS_CREATED: "billing.payment_intents_created",
  WEBHOOKS_PROCESSED: "billing.webhooks_processed",
  REFUNDS_PROCESSED: "billing.refunds_processed",
  IDEMPOTENCY_HITS: "billing.idempotency_hits",
} as const;
