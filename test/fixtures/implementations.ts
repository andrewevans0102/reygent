import type { ImplementOutput } from "../../src/task.js";

/** Auth implementation output */
export const authImplementation: ImplementOutput = {
  dev: {
    files: [
      "src/auth/login.ts",
      "src/auth/logout.ts",
      "src/auth/middleware.ts",
      "src/auth/jwt.ts",
      "src/auth/bcrypt.ts",
    ],
  },
  qe: {
    testFiles: [
      "src/auth/login.test.ts",
      "src/auth/logout.test.ts",
      "src/auth/middleware.test.ts",
      "src/auth/integration.test.ts",
    ],
  },
};

/** Caching implementation output */
export const cachingImplementation: ImplementOutput = {
  dev: {
    files: [
      "src/cache/redis.ts",
      "src/cache/user-profile.ts",
      "src/cache/api-response.ts",
      "src/cache/invalidation.ts",
    ],
  },
  qe: {
    testFiles: [
      "src/cache/redis.test.ts",
      "src/cache/user-profile.test.ts",
      "src/cache/api-response.test.ts",
      "src/cache/integration.test.ts",
    ],
  },
};

/** Minimal implementation */
export const minimalImplementation: ImplementOutput = {
  dev: {
    files: ["src/hello.ts"],
  },
  qe: {
    testFiles: ["src/hello.test.ts"],
  },
};

/** Dev-only implementation (QE agent skipped) */
export const devOnlyImplementation: ImplementOutput = {
  dev: {
    files: ["src/util.ts", "src/helper.ts"],
  },
  qe: null,
};

/** QE-only implementation (test-only changes) */
export const qeOnlyImplementation: ImplementOutput = {
  dev: null,
  qe: {
    testFiles: ["src/existing-feature.test.ts", "src/regression.test.ts"],
  },
};

/** Large implementation with many files */
export const largeImplementation: ImplementOutput = {
  dev: {
    files: [
      "src/products/model.ts",
      "src/products/controller.ts",
      "src/products/routes.ts",
      "src/products/service.ts",
      "src/cart/model.ts",
      "src/cart/controller.ts",
      "src/cart/routes.ts",
      "src/cart/service.ts",
      "src/checkout/model.ts",
      "src/checkout/controller.ts",
      "src/checkout/routes.ts",
      "src/checkout/service.ts",
      "src/payment/stripe.ts",
      "src/payment/webhooks.ts",
      "src/email/order-confirmation.ts",
      "src/admin/orders.ts",
    ],
  },
  qe: {
    testFiles: [
      "src/products/model.test.ts",
      "src/products/controller.test.ts",
      "src/products/integration.test.ts",
      "src/cart/model.test.ts",
      "src/cart/controller.test.ts",
      "src/cart/integration.test.ts",
      "src/checkout/model.test.ts",
      "src/checkout/controller.test.ts",
      "src/checkout/integration.test.ts",
      "src/payment/stripe.test.ts",
      "src/payment/webhooks.test.ts",
      "test/e2e/checkout-flow.test.ts",
    ],
  },
};
