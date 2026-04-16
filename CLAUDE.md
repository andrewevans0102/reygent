# Reygent

## Tech Stack

- TypeScript
- tsup (bundling)
- commander (CLI framework)
- Node.js

## Development

- Build: `npm run build`
- Dev: `npm run dev`

## Conventions

- Source code lives in `src/`
- Entry point: `src/cli.ts`
- Bundle output: `dist/`

## Terminal output style

This project uses **chalk**, **ora**, and **cli-progress** for terminal output. Always use these libraries instead of plain `console.log` for anything user-facing.

### Setup

Ensure these packages are installed:
```
npm install chalk ora cli-progress
```

All three are ESM-compatible. Use ESM imports (`import`) unless the project uses CommonJS, in which case use dynamic `import()`.

---

### chalk — colors and text styling

Use chalk for all colored or styled terminal text.

- `chalk.green('...')` — success messages
- `chalk.red('...')` — errors
- `chalk.yellow('...')` — warnings
- `chalk.blue('...')` or `chalk.cyan('...')` — info/labels
- `chalk.gray('...')` — secondary/muted text
- `chalk.bold('...')` — emphasis
- `chalk.bgBlue.white(' TAG ')` — inline badges/labels

Prefer semantic color choices (green = good, red = bad, yellow = caution). Chain styles: `chalk.bold.green(...)`. Do not use chalk for log messages that go to files or are machine-parsed.

---

### ora — spinners for async tasks

Use ora whenever an async operation takes perceptible time (network requests, file I/O, builds, etc.).

Pattern:
```js
import ora from 'ora';

const spinner = ora('Fetching data...').start();
try {
  await doWork();
  spinner.succeed(chalk.green('Done'));
} catch (err) {
  spinner.fail(chalk.red(`Failed: ${err.message}`));
}
```

- `.succeed(msg)` — green checkmark
- `.fail(msg)` — red cross
- `.warn(msg)` — yellow warning
- `.info(msg)` — blue info
- Always call `.succeed()`, `.fail()`, or `.stop()` — never leave a spinner running on exit.
- Use `spinner.text = '...'` to update the label mid-task.

---

### cli-progress — progress bars for batch work

Use cli-progress for operations with a known number of steps (file processing, batch uploads, loops, etc.).

Single bar:
```js
import { SingleBar, Presets } from 'cli-progress';

const bar = new SingleBar({
  format: '{task} {bar} {percentage}% | {value}/{total}',
  barCompleteChar: '█',
  barIncompleteChar: '░',
  hideCursor: true,
}, Presets.shades_classic);

bar.start(total, 0, { task: 'Processing' });
for (const item of items) {
  await process(item);
  bar.increment();
}
bar.stop();
```

Multi bar (parallel tasks):
```js
import { MultiBar, Presets } from 'cli-progress';
const multi = new MultiBar({ hideCursor: true }, Presets.shades_classic);
const b1 = multi.create(100, 0, { label: 'Task A' });
const b2 = multi.create(100, 0, { label: 'Task B' });
// ... increment individually
multi.stop();
```

- Always call `.stop()` when done.
- Do not mix `console.log` with an active progress bar — use `bar.update()` payload fields for status text instead.

---

### General conventions

- Start scripts with a chalk-styled header line identifying the tool and version.
- Print a blank line before and after progress bars and spinners for breathing room.
- On fatal errors: print with `chalk.red.bold('Error:')`, then the message, then `process.exit(1)`.
- Use `chalk.gray` for timestamps and secondary metadata.
- Keep output scannable: one concept per line, consistent indentation.