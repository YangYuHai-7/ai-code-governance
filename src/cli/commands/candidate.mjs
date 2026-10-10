import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { describeCandidateReview, openCandidateStore } from '../../modules/capabilities/index.mjs';

function describeText(review) {
  if (review.status === 'empty') return 'No candidate rules are recorded for this repository.\n';
  const lines = review.candidates.map((entry) => `${entry.id}\t${entry.state}\tnext: ${entry.nextAction}${entry.awaitingDecision ? '\tawaiting human owner' : ''}`);
  return `${lines.join('\n')}\n`;
}

// Read-only review surface: it reports candidates and their next legal action and never approves,
// promotes, or rolls back anything by itself.
export async function candidateCommand(target, action, options = {}) {
  if (action !== 'review') throw usageError('candidate requires an action: review.');
  const root = path.resolve(target ?? '.');
  const review = describeCandidateReview({ store: openCandidateStore(root) });
  process.stdout.write(options.json === true ? `${JSON.stringify(review, null, 2)}\n` : describeText(review));
  return review;
}
