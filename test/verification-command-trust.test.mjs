import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateVerificationCommandTrust,
  normalizeVerificationCommand,
  VERIFICATION_COMMAND_SCHEMA_VERSION,
} from '../src/modules/repository/verification-commands.mjs';

function npmCommand(scriptName = 'test') {
  return {
    schemaVersion: VERIFICATION_COMMAND_SCHEMA_VERSION,
    id: `web:${scriptName.replaceAll(':', '-')}`,
    unitId: 'web',
    cwd: 'apps/web',
    argv: ['npm', 'run', scriptName],
    source: { kind: 'npm-script', path: 'apps/web/package.json', scriptName },
    purpose: ['test'],
    scopeGlobs: ['apps/web/src/**'],
  };
}

function mavenCommand(...extra) {
  return {
    schemaVersion: VERIFICATION_COMMAND_SCHEMA_VERSION,
    id: 'api:test',
    unitId: 'api',
    cwd: 'services/api',
    argv: ['./mvnw', ...extra, 'test'],
    source: { kind: 'maven-pom', path: 'services/api/pom.xml' },
    purpose: ['test'],
    scopeGlobs: ['services/api/**'],
  };
}

function pom(configuration = '', profiles = '') {
  return `<project><properties></properties><build><plugins><plugin><artifactId>maven-surefire-plugin</artifactId><configuration>${configuration}</configuration></plugin></plugins></build>${profiles}</project>`;
}

function completeMavenEvidence(pomText, overrides = {}) {
  return {
    pomText,
    mavenModel: {
      mavenConfig: { status: 'absent' },
      parents: { status: 'complete', pomTexts: [] },
      modules: { status: 'complete', pomTexts: [] },
      ...overrides,
    },
  };
}

test('normalizes a shell-free structured verification command', () => {
  const command = normalizeVerificationCommand(npmCommand());
  assert.deepEqual(command.argv, ['npm', 'run', 'test']);
  assert.equal(command.cwd, 'apps/web');
  assert.equal(command.trust.level, 'declared');
  assert.throws(() => normalizeVerificationCommand({ ...npmCommand(), cwd: '../outside' }), /safe repository-relative/);
  assert.throws(() => normalizeVerificationCommand({ ...npmCommand(), cwd: 'C:\\outside' }), /safe repository-relative/);
  assert.throws(() => normalizeVerificationCommand({ ...npmCommand(), argv: [] }), /argv/);
});

test('trusts a terminating npm verification script with no implicit hooks', () => {
  const result = evaluateVerificationCommandTrust(npmCommand(), { npmScripts: { test: 'node --test' } });
  assert.equal(result.trust.level, 'structurally-trusted');
  assert.deepEqual(result.trust.reasons, []);
  assert.deepEqual(result.sideEffects, []);
});

test('trusts only allowlisted npm verification runner shapes', () => {
  for (const body of ['node --test test/unit.test.mjs', 'vitest run', 'jest --runInBand', 'eslint src', 'tsc --noEmit', 'vite build']) {
    const result = evaluateVerificationCommandTrust(npmCommand(), { npmScripts: { test: body } });
    assert.equal(result.trust.level, 'structurally-trusted', body);
  }
  const unsupported = evaluateVerificationCommandTrust(npmCommand(), { npmScripts: { test: 'custom-project-verifier --all' } });
  assert.equal(unsupported.trust.level, 'declared');
  assert.ok(unsupported.trust.reasons.some((entry) => entry.code === 'npm-runner-unsupported'));
});

for (const [label, implementation, reason] of [
  ['shell chaining', 'vitest run && node cleanup.mjs', 'npm-shell-composition'],
  ['network command', 'curl https://example.invalid/health', 'npm-network-command'],
  ['file deletion', 'rm -rf dist', 'npm-file-deletion'],
  ['cloud command', 'aws s3 sync dist s3://example', 'npm-external-action'],
  ['external command runner', 'npx vitest run', 'npm-external-command'],
  ['arbitrary Node evaluation', 'node --eval "process.exit(0)"', 'npm-node-eval'],
]) {
  test(`rejects npm ${label} by default`, () => {
    const result = evaluateVerificationCommandTrust(npmCommand(), { npmScripts: { test: implementation } });
    assert.equal(result.trust.level, 'untrusted');
    assert.ok(result.trust.reasons.some((entry) => entry.code === reason));
  });
}

test('rejects npm pre and post lifecycle hooks because they hide additional execution', () => {
  const result = evaluateVerificationCommandTrust(npmCommand(), {
    npmScripts: { pretest: 'node prepare-fixtures.mjs', test: 'node --test', posttest: 'node cleanup.mjs' },
  });
  assert.equal(result.trust.level, 'untrusted');
  assert.equal(result.trust.reasons.filter((entry) => entry.code === 'npm-lifecycle-hook').length, 2);
  assert.ok(result.sideEffects.includes('implicit-lifecycle-hook'));
});

for (const [label, scriptName, implementation, reason, sideEffect] of [
  ['eslint fix', 'lint', 'eslint . --fix', 'npm-fix-writes-source', 'source-write'],
  ['prettier write', 'format', 'prettier --write src', 'npm-write-writes-source', 'source-write'],
  ['watch flag', 'test:watch', 'vitest --watch', 'npm-non-terminating-script', 'non-terminating-process'],
  ['development server', 'dev', 'vite', 'npm-non-terminating-script', 'non-terminating-process'],
  ['publish', 'publish', 'npm publish', 'npm-external-action', 'external-action'],
  ['deploy', 'deploy:prod', 'firebase deploy', 'npm-external-action', 'external-action'],
]) {
  test(`rejects npm ${label} as a verification command`, () => {
    const result = evaluateVerificationCommandTrust(npmCommand(scriptName), { npmScripts: { [scriptName]: implementation } });
    assert.equal(result.trust.level, 'untrusted');
    assert.ok(result.trust.reasons.some((entry) => entry.code === reason));
    assert.ok(result.sideEffects.includes(sideEffect));
  });
}

test('keeps npm scripts declared when their implementation is unavailable', () => {
  const result = evaluateVerificationCommandTrust(npmCommand());
  assert.equal(result.trust.level, 'declared');
  assert.ok(result.trust.reasons.some((entry) => entry.code === 'npm-script-body-unavailable'));
});

test('reviews npm arguments in addition to the package script body', () => {
  const command = npmCommand();
  command.argv.push('--', '--watch');
  const result = evaluateVerificationCommandTrust(command, { npmScripts: { test: 'node --test' } });
  assert.equal(result.trust.level, 'untrusted');
  assert.ok(result.trust.reasons.some((entry) => entry.code === 'npm-non-terminating-script'));
});

test('trusts a Maven test command only after reviewing a non-skipping POM', () => {
  const result = evaluateVerificationCommandTrust(mavenCommand(), completeMavenEvidence(pom('<skipTests>false</skipTests><testFailureIgnore>false</testFailureIgnore>')));
  assert.equal(result.trust.level, 'structurally-trusted');
  assert.deepEqual(result.trust.reasons, []);
});

for (const [tag, reason] of [
  ['<skipTests>true</skipTests>', 'maven-skip-tests'],
  ['<maven.test.skip>true</maven.test.skip>', 'maven-test-skip'],
  ['<testFailureIgnore>true</testFailureIgnore>', 'maven-test-failure-ignore'],
  ['<maven.test.failure.ignore>true</maven.test.failure.ignore>', 'maven-test-failure-ignore'],
]) {
  test(`rejects Maven configuration ${tag}`, () => {
    const result = evaluateVerificationCommandTrust(mavenCommand(), completeMavenEvidence(pom(tag)));
    assert.equal(result.trust.level, 'untrusted');
    assert.ok(result.trust.reasons.some((entry) => entry.code === reason));
  });
}

test('Maven command-line false properties override unsafe POM defaults', () => {
  const result = evaluateVerificationCommandTrust(
    mavenCommand('-DskipTests=false', '-Dmaven.test.skip=false', '-Dmaven.test.failure.ignore=false'),
    completeMavenEvidence(pom('<skipTests>true</skipTests><maven.test.skip>true</maven.test.skip><testFailureIgnore>true</testFailureIgnore>')),
  );
  assert.equal(result.trust.level, 'structurally-trusted');
});

test('an explicitly activated Maven profile can make the test command fail closed', () => {
  const profiles = '<profiles><profile><id>strict-tests</id><build><plugins><plugin><configuration><skipTests>false</skipTests><testFailureIgnore>false</testFailureIgnore></configuration></plugin></plugins></build></profile></profiles>';
  const result = evaluateVerificationCommandTrust(mavenCommand('-Pstrict-tests'), completeMavenEvidence(
    pom('<skipTests>true</skipTests><testFailureIgnore>true</testFailureIgnore>', profiles),
  ));
  assert.equal(result.trust.level, 'structurally-trusted');
});

test('active-by-default Maven profiles participate in trust evaluation', () => {
  const profiles = '<profiles><profile><id>fast</id><activation><activeByDefault>true</activeByDefault></activation><properties><skipTests>true</skipTests></properties></profile></profiles>';
  const result = evaluateVerificationCommandTrust(mavenCommand(), completeMavenEvidence(pom('', profiles)));
  assert.equal(result.trust.level, 'untrusted');
  assert.ok(result.trust.reasons.some((entry) => entry.code === 'maven-skip-tests'));
});

test('incomplete Maven config, parent, and module evidence remains declared', () => {
  const simple = evaluateVerificationCommandTrust(mavenCommand(), { pomText: pom('<skipTests>false</skipTests>') });
  assert.equal(simple.trust.level, 'declared');
  assert.ok(simple.trust.reasons.some((entry) => entry.code === 'maven-effective-model-incomplete'));

  const withParent = '<project><parent><groupId>x</groupId><artifactId>parent</artifactId><version>1</version></parent></project>';
  const parent = evaluateVerificationCommandTrust(mavenCommand(), completeMavenEvidence(withParent, {
    parents: { status: 'unavailable', pomTexts: [] },
  }));
  assert.equal(parent.trust.level, 'declared');
  assert.ok(parent.trust.reasons.some((entry) => entry.code === 'maven-parent-model-incomplete'));

  const withModules = '<project><modules><module>child</module></modules></project>';
  const modules = evaluateVerificationCommandTrust(mavenCommand(), completeMavenEvidence(withModules, {
    modules: { status: 'complete', pomTexts: [] },
  }));
  assert.equal(modules.trust.level, 'declared');
  assert.ok(modules.trust.reasons.some((entry) => entry.code === 'maven-module-model-incomplete'));
});

test('Maven config arguments are evaluated when complete evidence is supplied', () => {
  const result = evaluateVerificationCommandTrust(mavenCommand(), completeMavenEvidence(pom('<skipTests>false</skipTests>'), {
    mavenConfig: { status: 'parsed', text: '-DskipTests=true' },
  }));
  assert.equal(result.trust.level, 'untrusted');
  assert.ok(result.trust.reasons.some((entry) => entry.code === 'maven-skip-tests'));
});

test('unresolved Maven properties and missing POM models remain declared rather than trusted', () => {
  const unresolved = evaluateVerificationCommandTrust(mavenCommand(), completeMavenEvidence(pom('<skipTests>${tests.skip}</skipTests>')));
  assert.equal(unresolved.trust.level, 'declared');
  assert.ok(unresolved.trust.reasons.some((entry) => entry.code === 'maven-skip-tests-unresolved'));
  const missing = evaluateVerificationCommandTrust(mavenCommand());
  assert.equal(missing.trust.level, 'declared');
  assert.ok(missing.trust.reasons.some((entry) => entry.code === 'maven-model-unavailable'));
});

test('Maven commands without a verification lifecycle goal are untrusted', () => {
  const command = mavenCommand();
  command.argv = ['./mvnw', 'package', '-DskipTests=false'];
  const result = evaluateVerificationCommandTrust(command, completeMavenEvidence(pom('<skipTests>false</skipTests>')));
  assert.equal(result.trust.level, 'untrusted');
  assert.ok(result.trust.reasons.some((entry) => entry.code === 'maven-verification-goal-missing'));
});
