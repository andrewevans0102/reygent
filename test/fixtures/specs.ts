import type { SpecPayload } from "../../src/spec.js";

/** Markdown spec example */
export const markdownSpec: SpecPayload = {
  source: "markdown",
  title: "Add user authentication",
  content: `# Add user authentication

## Summary
Implement JWT-based authentication with login, logout, and protected routes.

## Requirements
- Login endpoint POST /api/auth/login
- Logout endpoint POST /api/auth/logout
- Middleware to protect routes requiring authentication
- Use bcrypt for password hashing
- Store JWT in httpOnly cookie

## Acceptance Criteria
- User can login with valid credentials
- Invalid credentials return 401
- Protected routes return 401 when not authenticated
- User can logout and session is invalidated
`,
};

/** Linear spec example */
export const linearSpec: SpecPayload = {
  source: "linear",
  title: "DT-123: Implement caching layer",
  content: `Implement caching layer

## Description
Add Redis caching to reduce database load. Cache frequently accessed user profiles and API responses.

## Requirements
- Redis client integration
- Cache user profiles with 1hr TTL
- Cache API responses with 5min TTL
- Cache invalidation on updates

## Acceptance Criteria
- Cache hit rate > 80% for user profiles
- API response time reduced by 50%
- Cache invalidation works correctly
`,
  issueId: "DT-123",
};

/** Jira spec example */
export const jiraSpec: SpecPayload = {
  source: "jira",
  title: "PROJ-456: Refactor database schema",
  content: `Refactor database schema

## Description
Normalize user and organization tables to eliminate data duplication.

## Requirements
- Split user_org table into users and organizations
- Add user_memberships join table
- Migrate existing data
- Update all queries to use new schema

## Acceptance Criteria
- All tests pass after migration
- No data loss during migration
- Query performance unchanged or improved
`,
  issueKey: "PROJ-456",
};

/** Minimal spec for smoke tests */
export const minimalSpec: SpecPayload = {
  source: "markdown",
  title: "Hello world",
  content: "Print 'Hello, World!' to console.",
};
