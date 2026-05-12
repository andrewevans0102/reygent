import type { PlannerOutput } from "../../src/task.js";

/** Standard plan for auth feature */
export const authPlan: PlannerOutput = {
  goals: [
    "Implement JWT-based authentication system",
    "Secure password storage with bcrypt",
    "Protect routes requiring authentication",
  ],
  tasks: [
    "Create login endpoint POST /api/auth/login",
    "Create logout endpoint POST /api/auth/logout",
    "Add authentication middleware for protected routes",
    "Implement bcrypt password hashing",
    "Store JWT in httpOnly cookie",
    "Write unit tests for auth endpoints",
    "Write integration tests for auth flow",
  ],
  constraints: [
    "Use TypeScript",
    "Follow existing project structure",
    "Use existing JWT library (jsonwebtoken)",
    "Use bcrypt for password hashing (min 12 rounds)",
    "No plain text passwords in database",
  ],
  dod: [
    "Login endpoint accepts valid credentials and returns JWT",
    "Login endpoint rejects invalid credentials with 401",
    "Protected routes return 401 when not authenticated",
    "Protected routes allow access with valid JWT",
    "Logout endpoint invalidates JWT",
    "All unit tests pass",
    "All integration tests pass",
    "Code coverage > 80%",
  ],
};

/** Plan for caching layer feature */
export const cachingPlan: PlannerOutput = {
  goals: [
    "Reduce database load with Redis caching",
    "Improve API response times",
    "Implement cache invalidation strategy",
  ],
  tasks: [
    "Integrate Redis client",
    "Add cache wrapper for user profile queries",
    "Add cache wrapper for API responses",
    "Implement cache invalidation on updates",
    "Add cache metrics and monitoring",
    "Write unit tests for cache logic",
  ],
  constraints: [
    "Use ioredis library",
    "User profile TTL: 1 hour",
    "API response TTL: 5 minutes",
    "Cache keys must include version prefix",
  ],
  dod: [
    "Cache hit rate > 80% for user profiles",
    "API response time reduced by 50%",
    "Cache invalidation works on user updates",
    "All tests pass",
  ],
};

/** Minimal plan for hello world */
export const minimalPlan: PlannerOutput = {
  goals: ["Print hello world message"],
  tasks: ["Write console.log statement"],
  constraints: ["Use TypeScript"],
  dod: ["Output matches 'Hello, World!'"],
};

/** Plan with large number of tasks (stress test) */
export const largePlan: PlannerOutput = {
  goals: [
    "Implement complete e-commerce platform",
    "Support product catalog, cart, and checkout",
    "Integrate payment processing",
  ],
  tasks: [
    "Create product model and database schema",
    "Implement product CRUD endpoints",
    "Add product search and filtering",
    "Create shopping cart model",
    "Implement cart add/remove/update endpoints",
    "Add cart persistence for logged-in users",
    "Create checkout model",
    "Implement checkout validation",
    "Integrate Stripe payment API",
    "Add payment webhook handlers",
    "Implement order confirmation emails",
    "Create admin dashboard for orders",
    "Write unit tests for all models",
    "Write integration tests for API endpoints",
    "Write e2e tests for checkout flow",
  ],
  constraints: [
    "Use TypeScript",
    "Use PostgreSQL database",
    "Use Stripe for payments",
    "Follow REST API design principles",
    "Implement rate limiting",
    "Add input validation and sanitization",
  ],
  dod: [
    "All CRUD operations work correctly",
    "Cart persists across sessions",
    "Payment processing succeeds for valid cards",
    "Payment processing fails safely for invalid cards",
    "Webhooks handle all Stripe events",
    "Email confirmations sent on successful orders",
    "Admin dashboard shows all orders",
    "All tests pass",
    "Code coverage > 90%",
    "API documentation generated",
  ],
};
