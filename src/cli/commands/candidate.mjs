import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { describeCandidateReview, openCandidateStore, recordCandidateObservation } from '../../modules/capabilities/index.mjs';

function describeText(review) {
  if (review.status === 'empty') return 'No candidate rules are recorded for this repository.\n';
  const lines = review.candidates.map((entry) => `${entry.id}\t${entry.state}\tnext: ${entry.nextAction}${entry.awaitingDecision ? '\tawaiting human owner' : ''}`);
  return `${lines.join('\n')}\n`;
}

// Read-only review surface: it reports candidates and their next legal action and never approves,
// promotes, or rolls back anything by itself.
export async function candidateCommand(target, action, options = {}) {
  if (!['review', 'observe'].includes(action)) throw usageError('candidate requires an action: review or observe.');
  const root = path.resolve(target ?? '.');
  if (action === 'observe') {
    if (typeof options.text !== 'string' || options.text.length === 0) throw usageError('candidate observe requires --text <observation>.');
    const result = recordCandidateObservation({
      store: openCandidateStore(root),
      projectId: typeof options.project === 'string' && options.project.length > 0 ? options.project : path.basename(root),
      observation: { rule: options.text, id: options.id },
    });
    process.stdout.write(options.json === true ? `${JSON.stringify({ status: result.status, candidate: result.candidate.id, state: result.candidate.state }, null, 2)}\n` : `candidate ${result.candidate.id} ${result.status}\n`);
    return result;
  }
  const review = describeCandidateReview({ store: openCandidateStore(root) });
  process.stdout.write(options.json === true ? `${JSON.stringify(review, null, 2)}\n` : describeText(review));
  return review;
}