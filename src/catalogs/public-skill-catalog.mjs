import path from 'node:path';
import { PACKAGE_ROOT } from '../kernel/config/constants.mjs';
import { readJson } from '../adapters/filesystem/index.mjs';

/**
 * The packaged public-Skill catalog: offline metadata for `adaptiveGovernance.curatedCatalog`.
 *
 * AICG never clones, installs, upgrades or executes a third-party Skill. This module only reads
 * the snapshot committed under `assets/registries/`, which `scripts/skill-catalog.mjs` regenerates
 * from pinned upstream commits. Every record is a candidate that still needs an explicit owner
 * decision and the exact `--approve <planHash>`; nothing here is preselected or activated.
 */
export const PUBLIC_SKILL_SOURCES_PATH = 'assets/registries/public-skill-sources.json';
export const PUBLIC_SKILL_CATALOG_PATH = 'assets/registries/public-skill-catalog.json';

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SOURCE = /^(?:official|curated):[A-Za-z0-9._/-]{1,180}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_CATALOG_ENTRIES = 256;

function invalid(message) {
  return new Error(`Public Skill catalog is invalid: ${message}`);
}

function idList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32
    || value.some((item) => typeof item !== 'string' || !ID.test(item))) throw invalid(`${label} must be a bounded identifier list.`);
  return value;
}

/**
 * Read and validate the committed snapshot. Throws rather than returning a partial catalog, so a
 * corrupted or tampered snapshot fails closed instead of silently shrinking the candidate set.
 */
export function loadPublicSkillCatalog() {
  let document;
  try {
    document = readJson(path.join(PACKAGE_ROOT, PUBLIC_SKILL_CATALOG_PATH));
  } catch (error) {
    throw invalid(error.message);
  }
  if (document.schema_version !== 1 || !Array.isArray(document.catalog)) throw invalid('unsupported schema version.');
  if (document.catalog.length > MAX_CATALOG_ENTRIES) throw invalid(`more than ${MAX_CATALOG_ENTRIES} records.`);
  const seen = new Set();
  const owners = new Set();
  for (const [index, record] of document.catalog.entries()) {
    const where = `catalog[${index}]`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw invalid(`${where} must be an object.`);
    if (typeof record.id !== 'string' || !ID.test(record.id)) throw invalid(`${where}.id is invalid.`);
    if (typeof record.source !== 'string' || !SOURCE.test(record.source)) throw invalid(`${where}.source is invalid.`);
    if (typeof record.name !== 'string' || !ID.test(record.name)) throw invalid(`${where}.name is invalid.`);
    idList(record.capabilities, `${where}.capabilities`);
    if (typeof record.capabilityOwner !== 'string' || !record.capabilities.includes(record.capabilityOwner)) throw invalid(`${where}.capabilityOwner must be one of its capabilities.`);
    if (!Array.isArray(record.permissions) || record.permissions.some((item) => typeof item !== 'string' || !ID.test(item))) throw invalid(`${where}.permissions is invalid.`);
    if (typeof record.contentSha256 !== 'string' || !SHA256.test(record.contentSha256)) throw invalid(`${where}.contentSha256 must be 64 hex.`);
    if (!Number.isInteger(record.contentBytes) || record.contentBytes <= 0) throw invalid(`${where}.contentBytes must be a positive integer.`);
    if (typeof record.verifiedAt !== 'string' || Number.isNaN(Date.parse(record.verifiedAt))) throw invalid(`${where}.verifiedAt must be an ISO timestamp.`);
    if (typeof record.version !== 'string' || !record.version) throw invalid(`${where}.version is required.`);
    if (seen.has(record.id)) throw invalid(`duplicate record id ${record.id}.`);
    seen.add(record.id);
    if (owners.has(record.capabilityOwner)) throw invalid(`capability owner ${record.capabilityOwner} appears twice.`);
    owners.add(record.capabilityOwner);
  }
  return document;
}

/** Detached copies for `discoverSkills({ curatedCatalog })`, safe to mutate in the caller. */
export function loadCuratedSkillRecords() {
  return loadPublicSkillCatalog().catalog.map((record) => structuredClone(record));
}
