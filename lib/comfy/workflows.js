import fs from 'fs';
import path from 'path';
import { comfyWorkflowsFile } from '../paths.js';

function ensureRegistryFile() {
  const dir = path.dirname(comfyWorkflowsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(comfyWorkflowsFile)) {
    fs.writeFileSync(comfyWorkflowsFile, '[]\n');
  }
}

function detectWorkflowFormat(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return 'api';
  }

  if (Array.isArray(workflow.nodes) && Array.isArray(workflow.links)) {
    return 'workflow';
  }

  return 'api';
}

function readWorkflowRegistry() {
  ensureRegistryFile();

  try {
    const data = JSON.parse(fs.readFileSync(comfyWorkflowsFile, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeWorkflowRegistry(entries) {
  ensureRegistryFile();
  fs.writeFileSync(comfyWorkflowsFile, `${JSON.stringify(entries, null, 2)}\n`);
}

function normalizeWorkflowEntry(entry, existing = null) {
  const now = new Date().toISOString();
  return {
    name: entry.name.trim(),
    format: entry.format || detectWorkflowFormat(entry.workflow),
    workflow: entry.workflow,
    description: entry.description || '',
    defaults: entry.defaults || {},
    created_at: existing?.created_at || now,
    updated_at: now,
  };
}

function listWorkflowEntries() {
  return readWorkflowRegistry();
}

function listWorkflowSummaries() {
  return readWorkflowRegistry().map((entry) => ({
    name: entry.name,
    format: entry.format,
    description: entry.description || '',
    defaults: entry.defaults || {},
    created_at: entry.created_at || null,
    updated_at: entry.updated_at || null,
  }));
}

function getWorkflowEntry(name) {
  return readWorkflowRegistry().find((entry) => entry.name === name) || null;
}

function upsertWorkflowEntry(entry) {
  const items = readWorkflowRegistry();
  const index = items.findIndex((item) => item.name === entry.name.trim());
  const current = index >= 0 ? items[index] : null;
  const normalized = normalizeWorkflowEntry(entry, current);

  if (index >= 0) {
    items[index] = normalized;
  } else {
    items.push(normalized);
  }

  writeWorkflowRegistry(items);
  return normalized;
}

function deleteWorkflowEntry(name) {
  const items = readWorkflowRegistry();
  const index = items.findIndex((item) => item.name === name);
  if (index < 0) {
    return { deleted: false };
  }

  const [removed] = items.splice(index, 1);
  writeWorkflowRegistry(items);
  return { deleted: true, workflow: removed };
}

export {
  detectWorkflowFormat,
  readWorkflowRegistry,
  writeWorkflowRegistry,
  listWorkflowEntries,
  listWorkflowSummaries,
  getWorkflowEntry,
  upsertWorkflowEntry,
  deleteWorkflowEntry,
};
