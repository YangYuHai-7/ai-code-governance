import { listDeliveryInspections, readDeliveryInspection } from '../../modules/delivery-inspection/index.mjs';

function printText(result) {
  if (result.sessions) {
    const sessions = result.sessions.map((entry) => `${entry.sessionId}:${entry.state}:${entry.semanticDigest}`).join(' ');
    console.log(`delivery_sessions=${result.count} total=${result.total} truncated=${result.truncated}${sessions ? ` ${sessions}` : ''}`);
    return;
  }
  console.log(`delivery_session=${result.sessionId} state=${result.state} digest=${result.semanticDigest}`);
}

export function deliveryInspectionCommand(target, options = {}) {
  const result = options.session
    ? readDeliveryInspection(target, options.session)
    : listDeliveryInspections(target);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printText(result);
  return result;
}
