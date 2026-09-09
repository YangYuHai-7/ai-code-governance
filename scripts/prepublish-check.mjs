#!/usr/bin/env node

import { PACKAGE_ROOT } from '../src/constants.mjs';
import { runReleaseAcceptance } from '../src/release-acceptance.mjs';

const changeType = process.env.AICG_RELEASE_TYPE;
const evidencePath = process.env.AICG_RELEASE_EVIDENCE;
const replayApproval = process.env.AICG_RELEASE_APPROVAL;

if (!changeType || !evidencePath || !replayApproval) {
  console.error('Publishing requires AICG_RELEASE_TYPE=bugfix|feature|major, AICG_RELEASE_EVIDENCE=<repository-relative-json>, and AICG_RELEASE_APPROVAL=<exact-replay-plan-hash>.');
  process.exitCode = 1;
} else {
  const result = runReleaseAcceptance(PACKAGE_ROOT, { changeType, evidencePath, replayCommands: true, replayApproval, verifyPackageArtifact: true });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
