#!/usr/bin/env node

import { PACKAGE_ROOT } from '../src/constants.mjs';
import {
  resolvePrepublishMode,
  runEngineeringPublicationGate,
  runReleaseAcceptance,
} from '../src/release-acceptance.mjs';

let mode;
try {
  mode = resolvePrepublishMode(process.env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

if (mode) {
  const result = mode.mode === 'organizational-certification'
    ? runReleaseAcceptance(PACKAGE_ROOT, {
        changeType: mode.changeType,
        evidencePath: mode.evidencePath,
        replayCommands: true,
        replayApproval: mode.replayApproval,
        verifyPackageArtifact: true,
      })
    : runEngineeringPublicationGate(PACKAGE_ROOT);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
