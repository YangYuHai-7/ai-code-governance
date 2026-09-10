import path from 'node:path';
import {
  certificationEvidenceStatus,
  exportCertificationEvidence,
  readCertificationReceiptInput,
  recordCertificationEvidence,
} from '../../modules/evidence/index.mjs';
import { usageError } from '../../kernel/index.mjs';

export function evidenceCommand(target, action, options) {
  const root = path.resolve(target);
  if (action === 'status') {
    console.log(JSON.stringify(certificationEvidenceStatus(root), null, 2));
    return;
  }
  if (action === 'export') {
    console.log(JSON.stringify(exportCertificationEvidence(root), null, 2));
    return;
  }
  if (action !== 'record') throw usageError('evidence requires an action: record, status, or export.');
  if (!options.config) throw usageError('evidence record requires --config with a repository-relative receipt JSON path.');
  if (!options.yes) throw usageError('evidence record writes an anonymized receipt ledger and requires --yes.');
  const receipt = readCertificationReceiptInput(root, options.config);
  recordCertificationEvidence(root, receipt);
  console.log(JSON.stringify({ recorded: receipt, status: certificationEvidenceStatus(root) }, null, 2));
}
