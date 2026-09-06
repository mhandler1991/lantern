/**
 * Everything wrong with a file, shown as one block and copyable as one block.
 *
 * DATA-MODEL.md §11 — most people will not read a schema. They will paste a template
 * and their notes into a chat window, and the way they fix what comes back is by pasting
 * the errors in after it. **So the unit here is the whole report, not a line of it**:
 * the heading names the file the paths below belong to, and one button takes the lot.
 * A player picking lines out of a paragraph is a player who pastes half the problem.
 *
 * The button is a convenience and never a gate. The block is on screen and selectable
 * whether the clipboard works or not (`ui/clipboard.ts`), which is the same reading the
 * invite link gets in `Lobby.tsx`.
 *
 * Nothing here renders markup from a string. A path and a value both come out of a file
 * that may have been written by anyone, and they are text nodes like every other value
 * in the app — CLAUDE.md §2.6.
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import type { Problem } from '../model/problems';
import { reportProblems } from '../model/problems';
import { copyText } from './clipboard';

/** What the last copy did, and which report it did it to. */
type CopyState = {
  readonly report: string;
  readonly outcome: 'copied' | 'unavailable';
};

export function ProblemReport({
  subject,
  problems,
}: {
  /** What the paths below belong to — a file name, a pack name, the sheet. */
  readonly subject: string;
  readonly problems: readonly Problem[];
}): ReactElement {
  const [copy, setCopy] = useState<CopyState | null>(null);
  const report = reportProblems(problems, subject);

  // Compared rather than cleared by an effect: a second file with different problems is
  // a different report, and "Copied" left standing over it would be a lie. CLAUDE.md §6.
  const outcome = copy !== null && copy.report === report ? copy.outcome : null;

  async function copyReport(): Promise<void> {
    const result = await copyText(report);
    setCopy({ report, outcome: result.ok ? 'copied' : 'unavailable' });
  }

  return (
    <div className="problem-report">
      <p className="problems">{report}</p>
      <div className="row-actions">
        <button type="button" className="button" onClick={() => void copyReport()}>
          Copy the problems
        </button>
        {outcome === 'copied' && (
          <span className="readout" role="status">
            Copied. Paste it back into whatever wrote the file.
          </span>
        )}
        {outcome === 'unavailable' && (
          <span className="readout" role="status">
            This browser would not let us copy it — select the lines above instead.
          </span>
        )}
      </div>
    </div>
  );
}
