# Terminal Cursor Alignment — Manual QA

Manual QA scenarios for verifying terminal cursor alignment fixes in `reygent review-comments` TUI.

---

## Prerequisites

- Working `reygent` build: `npm run build`
- Terminal with bracketed paste support (iTerm2, Alacritty, modern gnome-terminal, etc.)
- Test repository with open PR and review comments

---

## Scenario 1: Multi-line paste preserves formatting

**Goal:** Verify pasted multi-line text preserves internal newlines and doesn't auto-submit.

**Steps:**

1. Run `reygent review-comments`
2. Wait for plan to display
3. Choose "Provide feedback — regenerate plan"
4. Copy this multi-line text to clipboard:
   ```
   First line of feedback
   Second line of feedback
   Third line of feedback
   ```
5. Paste into feedback prompt (Cmd+V / Ctrl+Shift+V)
6. Press Enter to submit

**Expected:**
- Pasted text appears with internal newlines preserved (3 lines visible in prompt)
- Prompt does NOT auto-submit on paste (trailing newline stripped)
- User must press Enter explicitly to submit
- Regenerated plan reflects all 3 lines of feedback

**Failure modes:**
- Newlines replaced with spaces → indicates pasteable-input.ts fix not applied
- Prompt auto-submits on paste → indicates trailing newline not stripped

---

## Scenario 2: Rapid spinner → prompt transitions (no cursor lock)

**Goal:** Verify cursor doesn't "lock" after rapid spinner start/stop cycles.

**Steps:**

1. Run `reygent review-comments` on PR with many comments
2. Observe planner spinner start/stop
3. At approval prompt, choose "Provide feedback"
4. Enter short feedback like "looks good"
5. Wait for plan regeneration spinner
6. At next approval prompt, type several characters: `abcdefgh`
7. Use arrow keys (← →) to move cursor left/right
8. Use backspace to delete characters

**Expected:**
- Cursor moves correctly left/right with arrow keys
- Backspace deletes the character to the left of cursor
- Typing inserts at cursor position
- No "cursor stuck on one line" behavior
- No invisible characters or phantom text

**Failure modes:**
- Cursor stuck on one line → indicates terminal reset incomplete
- Backspace doesn't delete → readline cursor desync
- Typing doesn't appear → stdin in wrong mode

---

## Scenario 3: SIGINT during prompt (spinner cleanup)

**Goal:** Verify SIGINT (Ctrl+C) during prompt cleans up all spinners and exits gracefully.

**Steps:**

1. Run `reygent review-comments`
2. Wait for planner spinner to start
3. Press Ctrl+C during spinner (before approval prompt)
4. Observe exit

**Expected:**
- Spinner stops immediately
- Process exits with code 130 (SIGINT convention)
- No "spinner still running" artifacts in terminal
- Cursor visible after exit
- No terminal state corruption (can run next command normally)

**Repeat:**
5. Run `reygent review-comments` again
6. Wait for approval prompt
7. Press Ctrl+C at approval prompt
8. Observe exit

**Expected (at prompt):**
- Prompt exits cleanly
- Process exits with code 0 (inquirer convention)
- Cursor visible, no artifacts

**Failure modes:**
- Spinner doesn't stop → SIGINT handler not cleaning up
- Terminal cursor hidden after exit → resetTerminalForInput not called
- Process hangs → SIGINT handler not installed

---

## Scenario 4: Concurrent spinners (no raw mode conflicts)

**Goal:** Verify terminal reset doesn't break concurrent readline/spinner instances.

**Steps:**

1. Modify `src/commands/review-comments.ts` to add artificial delay before approval loop:
   ```ts
   displayPlan(plan);

   // Artificial delay to test concurrent spinner scenario
   await new Promise(resolve => setTimeout(resolve, 100));

   if (!options.autoApprove) {
   ```
2. Run `reygent review-comments`
3. Wait for approval prompt
4. Choose "Provide feedback" immediately after prompt appears
5. Type feedback while any background spinners may still be cleaning up

**Expected:**
- Typing works correctly in feedback input
- No "raw mode already set" errors
- No input lost or garbled
- Feedback submits correctly

**Failure modes:**
- Input garbled → raw mode conflict between spinner cleanup and readline
- Typing doesn't appear → stdin in wrong mode
- Error: "Cannot read property 'setRawMode'" → stdin race condition

**Cleanup:** Remove artificial delay after test.

---

## Scenario 5: Backspace-heavy editing (cursor position tracking)

**Goal:** Verify readline cursor position stays in sync during heavy editing.

**Steps:**

1. Run `reygent review-comments`
2. Choose "Provide feedback" at approval prompt
3. Type long string: `This is a very long feedback message that will wrap past terminal width if your terminal is narrow`
4. Press Home key (or Ctrl+A) to move cursor to start
5. Use → arrow key to move cursor to middle of line
6. Press backspace 10 times
7. Type new text: `EDITED`
8. Press End key (or Ctrl+E) to move cursor to end
9. Press Enter to submit

**Expected:**
- Cursor moves correctly with Home/End/arrow keys
- Backspace deletes exactly 10 characters to the left of cursor
- New text `EDITED` appears at cursor position
- Final submitted text matches what's visible in prompt
- No cursor position desync (text appears where cursor is)

**Failure modes:**
- Cursor appears in wrong position → readline cursor tracking broken
- Backspace deletes wrong characters → cursor desync
- Text appears at wrong position when typing → readline state corrupt

---

## Scenario 6: Terminal resize during input (word wrap handling)

**Goal:** Verify prompt handles terminal resize without cursor corruption.

**Steps:**

1. Run `reygent review-comments` in resizable terminal
2. Choose "Provide feedback" at approval prompt
3. Type long string that wraps to multiple lines
4. While cursor is in middle of multi-line text, resize terminal window:
   - Make narrower (text should re-wrap to more lines)
   - Make wider (text should re-wrap to fewer lines)
5. Continue typing and editing
6. Press Enter to submit

**Expected:**
- Text re-wraps correctly on resize
- Cursor position stays correct after resize
- Editing (backspace, arrow keys) works correctly after resize
- Submitted text matches what's visible

**Failure modes:**
- Cursor position wrong after resize → readline not handling SIGWINCH
- Text garbled after resize → word wrap calculation broken
- Editing broken after resize → readline cursor desync

---

## Scenario 7: Activity detail with newlines (single-line spinner format)

**Goal:** Verify spinner activity detail sanitizes newlines to prevent line breaks.

**Steps:**

1. Modify `src/live-status.ts` temporarily to inject newlines in activity detail:
   ```ts
   lastActivity = {
     ...event,
     detail: "src/foo.ts\nline 2\nline 3", // Force newlines
   };
   ```
2. Run `reygent review-comments`
3. Observe planner spinner output

**Expected:**
- Spinner line remains single line
- Newlines in activity detail replaced with spaces: `src/foo.ts line 2 line 3`
- No line breaks or cursor alignment issues

**Failure modes:**
- Spinner output has line breaks → newline sanitization not applied
- Cursor jumps to wrong position → multi-line spinner breaking terminal state

**Cleanup:** Remove temporary modification after test.

---

## Scenario 8: Stdin discard during spinner (input preservation)

**Goal:** Verify user input typed during spinner is NOT discarded.

**Steps:**

1. Run `reygent review-comments`
2. While planner spinner is running, type ahead: `feedback text`
3. Wait for approval prompt to appear
4. Observe if typed text appears in prompt buffer

**Expected:**
- Typed text preserved and appears in prompt input buffer
- User doesn't need to re-type
- No input lost

**Failure modes:**
- Typed text lost → `discardStdin: true` not fixed
- Partial input lost → stdin buffering broken

---

## Pass Criteria

All 8 scenarios PASS with no failure modes observed.

---

## Known Limitations

- Bracketed paste mode requires terminal emulator support (not available in basic TTY, Windows cmd.exe)
- Scenario 4 (concurrent spinners) is artificial — normal workflow doesn't trigger this race condition
- Scenario 7 requires code modification for reproducibility — may not occur in production

---

## Reporting Issues

If any scenario fails:

1. Note exact failure mode observed
2. Record terminal emulator + version (e.g., "iTerm2 3.4.16")
3. Capture terminal output (screenshot or asciinema recording)
4. Note OS + Node.js version
5. File issue with reproduction steps

---

*QA scenarios for DT-303 terminal cursor alignment fixes*
