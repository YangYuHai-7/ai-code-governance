import { parentPort, workerData } from 'node:worker_threads';
import { scanProject } from './scanner.mjs';

/**
 * Runs one repository scan off the main event loop so the HTTP server can keep answering
 * /api/progress while a large repository is walked. Progress is forwarded as it happens; the
 * final scan is posted once so the caller can keep its existing synchronous code path.
 */
const scan = scanProject(workerData.root, {
  probeEnvironment: false,
  ...(workerData.options ?? {}),
  onProgress: (progress) => parentPort.postMessage({ type: 'progress', progress }),
});
parentPort.postMessage({ type: 'result', scan });
