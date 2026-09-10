const [riskId, variant] = process.argv.slice(2);

function webhookSecret() {
  const vulnerableAccepts = (secret) => !secret || secret === 'configured-secret';
  const repairedAccepts = (secret) => typeof secret === 'string' && secret.length >= 16;
  if (variant === 'vulnerable') {
    const dangerousAccepted = vulnerableAccepts(undefined);
    return dangerousAccepted
      ? { outcome: 'blocked', diagnostic: 'A request without a webhook secret was accepted.' }
      : null;
  }
  const deniedMissing = !repairedAccepts(undefined);
  const acceptedConfigured = repairedAccepts('rotated-secret-1234');
  return deniedMissing && acceptedConfigured ? {
    outcome: 'passed',
    negativeDiagnostic: 'A request without a webhook secret was rejected.',
    recoveryEvidence: 'A request with the rotated configured secret was accepted.',
  } : null;
}

function vaultDefaultToken() {
  const defaultToken = 'dev-token';
  const vulnerableAccepts = (token) => token === defaultToken;
  const repairedAccepts = (token) => token !== defaultToken && token === 'rotated-vault-token';
  if (variant === 'vulnerable') {
    return vulnerableAccepts(defaultToken)
      ? { outcome: 'blocked', diagnostic: 'The shipped default vault token authenticated successfully.' }
      : null;
  }
  return !repairedAccepts(defaultToken) && repairedAccepts('rotated-vault-token') ? {
    outcome: 'passed',
    negativeDiagnostic: 'The shipped default vault token was rejected.',
    recoveryEvidence: 'A rotated project-specific vault token authenticated successfully.',
  } : null;
}

function bodyActorIdentity() {
  const principal = { id: 'trusted-user' };
  const requestBody = { actorId: 'attacker-selected-user' };
  const vulnerableActor = requestBody.actorId ?? principal.id;
  const repairedActor = principal.id;
  if (variant === 'vulnerable') {
    return vulnerableActor === requestBody.actorId
      ? { outcome: 'blocked', diagnostic: 'The request body selected the authoritative actor identity.' }
      : null;
  }
  return repairedActor !== requestBody.actorId && repairedActor === principal.id ? {
    outcome: 'passed',
    negativeDiagnostic: 'The request-controlled actor identity was ignored.',
    recoveryEvidence: 'The trusted authenticated principal remained the authoritative actor.',
  } : null;
}

function inactiveMembership() {
  const vulnerableAllows = (membership) => Boolean(membership);
  const repairedAllows = (membership) => membership?.status === 'active';
  const inactive = { status: 'inactive' };
  const active = { status: 'active' };
  if (variant === 'vulnerable') {
    return vulnerableAllows(inactive)
      ? { outcome: 'blocked', diagnostic: 'An inactive membership was authorized.' }
      : null;
  }
  return !repairedAllows(inactive) && repairedAllows(active) ? {
    outcome: 'passed',
    negativeDiagnostic: 'The inactive membership was denied.',
    recoveryEvidence: 'An active membership was authorized.',
  } : null;
}

function canceledInvoiceSettlement() {
  const vulnerableSettles = (invoice) => invoice.amount > 0;
  const repairedSettles = (invoice) => invoice.status === 'payable' && invoice.amount > 0;
  const canceled = { status: 'canceled', amount: 100 };
  const payable = { status: 'payable', amount: 100 };
  if (variant === 'vulnerable') {
    return vulnerableSettles(canceled)
      ? { outcome: 'blocked', diagnostic: 'A canceled invoice was settled.' }
      : null;
  }
  return !repairedSettles(canceled) && repairedSettles(payable) ? {
    outcome: 'passed',
    negativeDiagnostic: 'Settlement of the canceled invoice was rejected.',
    recoveryEvidence: 'A payable invoice completed the allowed settlement path.',
  } : null;
}

function multiInstanceLostUpdate() {
  if (variant === 'vulnerable') {
    const store = { value: 0 };
    const firstRead = store.value;
    const secondRead = store.value;
    store.value = firstRead + 1;
    store.value = secondRead + 1;
    return store.value === 1
      ? { outcome: 'blocked', diagnostic: 'Two concurrent increments produced value=1 instead of value=2.' }
      : null;
  }
  const store = { value: 0, version: 0 };
  const read = () => ({ ...store });
  const compareAndSet = (snapshot, nextValue) => {
    if (snapshot.version !== store.version) return false;
    store.value = nextValue;
    store.version += 1;
    return true;
  };
  const firstRead = read();
  const secondRead = read();
  const firstWritten = compareAndSet(firstRead, firstRead.value + 1);
  const conflictDetected = !compareAndSet(secondRead, secondRead.value + 1);
  const retryRead = read();
  const retryWritten = compareAndSet(retryRead, retryRead.value + 1);
  return firstWritten && conflictDetected && retryWritten && store.value === 2 ? {
    outcome: 'passed',
    negativeDiagnostic: 'The stale concurrent write was rejected by version comparison.',
    recoveryEvidence: 'Retrying from the current version preserved both increments with value=2.',
  } : null;
}

const probes = {
  'webhook-secret-missing': webhookSecret,
  'vault-default-token': vaultDefaultToken,
  'body-actor-identity': bodyActorIdentity,
  'inactive-membership': inactiveMembership,
  'canceled-invoice-settlement': canceledInvoiceSettlement,
  'multi-instance-lost-update': multiInstanceLostUpdate,
};

if (!probes[riskId] || !['vulnerable', 'repaired'].includes(variant)) {
  console.error('Unknown risk toy probe.');
  process.exit(2);
}

const result = probes[riskId]();
if (!result) {
  console.error('Risk toy probe did not observe its expected behavior.');
  process.exit(2);
}

console.log(`AICG_RISK_PROBE ${JSON.stringify({ schemaVersion: 1, riskId, variant, ...result })}`);
process.exit(result.outcome === 'blocked' ? 1 : 0);
