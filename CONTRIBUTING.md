# Contributing to Reygent

Thank you for your interest in contributing to Reygent! This document provides guidelines and instructions for contributing to the project.

## Getting Started

### Prerequisites

- Node.js 22 or higher
- npm

### Local Development Setup

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/reygent.git
   cd reygent
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the project:
   ```bash
   npm run build
   ```
5. Run in development mode:
   ```bash
   npm run dev
   ```

### Running Tests

Run the test suite:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

Run tests with coverage:
```bash
npm run test:coverage
```

Run integration tests:
```bash
npm run test:integration
```

## Branching Strategy

Reygent uses a two-branch workflow:

- **`develop`** — The default branch. All feature PRs should target `develop`.
- **`main`** — The release branch. Merges from `develop` to `main` trigger automated releases via semantic-release.

### Workflow

1. Create a feature branch from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/your-feature-name
   ```
2. Make your changes and commit using conventional commit format (see below)
3. Push your branch and open a PR against `develop`
4. After review and approval, your PR will be merged to `develop`
5. When ready for release, a maintainer will merge `develop` to `main`, triggering an automated release

## Conventional Commits

Reygent uses [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages. This format is **enforced** via commitlint and husky.

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

- **feat:** A new feature (triggers minor version bump)
- **fix:** A bug fix (triggers patch version bump)
- **docs:** Documentation only changes
- **style:** Changes that don't affect code meaning (whitespace, formatting)
- **refactor:** Code change that neither fixes a bug nor adds a feature
- **perf:** Performance improvement
- **test:** Adding missing tests or correcting existing tests
- **chore:** Changes to build process, tooling, or dependencies

### Breaking Changes

For breaking changes, add `!` after the type or add `BREAKING CHANGE:` in the footer:

```
feat!: remove support for Node 20

BREAKING CHANGE: Node 22 is now the minimum required version.
```

Breaking changes trigger a major version bump.

### Examples

Good commit messages:
```
feat: add gemini provider support
fix: resolve token counting error in claude provider
docs: update CONTRIBUTING with conventional commit examples
refactor: extract branch type detection to separate module
test: add unit tests for config loader
chore: upgrade typescript to v6
```

Bad commit messages (will be rejected by commitlint):
```
added new feature
Fixed bug
Update readme
WIP
.
```

## Pull Request Guidelines

### What Makes a Good PR

- **One concern per PR:** Each PR should address a single feature, bug fix, or refactor. Don't bundle unrelated changes.
- **Tests included:** Add or update tests alongside your code changes.
- **Clear description:** Use the PR template to describe what changed and why.
- **Conventional commits:** All commits in the PR must follow conventional commit format.
- **Target `develop`:** PRs should target the `develop` branch, not `main`.
- **Pass CI checks:** Ensure all tests and linting pass before requesting review.

### What to Avoid

- **Don't bump `package.json` version:** semantic-release handles versioning automatically based on commit messages.
- **Don't include merge commits:** Rebase your branch on `develop` before opening a PR.
- **Don't mix formatting changes with logic changes:** Keep style/formatting fixes in separate PRs.

## Code Style

- TypeScript is required for all source code
- Follow existing code conventions (indentation, naming, etc.)
- Use ESM imports (`import`/`export`, not `require`)
- Prefer explicit types over `any`

## Testing

- Write unit tests for new features and bug fixes
- Place tests alongside the code they test (e.g., `src/config.test.ts` for `src/config.ts`)
- Use descriptive test names that explain what is being tested and the expected outcome

## Release Process

Reygent uses semantic-release to automate versioning and publishing. **Contributors do not manually version the package.**

When PRs are merged to `develop` and then `develop` is merged to `main`:

1. semantic-release analyzes all conventional commits since the last release
2. Determines the next version based on commit types (feat = minor, fix = patch, BREAKING CHANGE = major)
3. Updates `CHANGELOG.md` with release notes
4. Bumps `package.json` version
5. Publishes the package to npm with provenance
6. Creates a GitHub Release
7. Commits version changes back to `main`

## Questions or Issues?

If you have questions or run into issues while contributing, please open an issue on GitHub or reach out to the maintainers.

Thank you for contributing!
