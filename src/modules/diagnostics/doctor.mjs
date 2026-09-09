import fs from 'node:fs';

export function doctor(scan) {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  const agents = scan.agents.map((agent) => ({
    id: agent.id,
    availability: agent.availability,
    command: agent.command,
    version: agent.version,
  }));
  const checks = {
    targetDirectory: fs.statSync(scan.root).isDirectory(),
    writable: (() => {
      try {
        fs.accessSync(scan.root, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    })(),
    nodeSupported: nodeMajor >= 22,
    environmentCommandProbe: scan.environmentProbe,
  };
  return {
    ok: checks.targetDirectory && checks.writable && checks.nodeSupported,
    target: scan.root,
    currentOs: scan.currentOs,
    architecture: scan.architecture,
    node: process.versions.node,
    gitRoot: scan.gitRoot,
    checks,
    agents,
    managedLinksDetected: scan.links.filter((relative) => /(^|\/)(\.cursor|\.claude|\.agents|docs\/ai)(\/|$)/.test(relative)),
  };
}

export function printDoctor(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`doctor=${result.ok ? 'pass' : 'fail'} os=${result.currentOs} arch=${result.architecture} node=${result.node}`);
  console.log(`target=${result.target}`);
  for (const [name, value] of Object.entries(result.checks)) console.log(`${name}=${typeof value === 'boolean' ? (value ? 'pass' : 'fail') : value}`);
  for (const agent of result.agents) console.log(`agent.${agent.id}=${agent.version ?? agent.availability}`);
  for (const link of result.managedLinksDetected) console.warn(`WARN: managed link detected: ${link}`);
}
