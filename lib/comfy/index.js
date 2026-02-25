import { createComfyClient, ComfyClientError, isComfyEnabled } from './client.js';
import {
  listWorkflowEntries,
  listWorkflowSummaries,
  getWorkflowEntry,
  upsertWorkflowEntry,
  deleteWorkflowEntry,
} from './workflows.js';
import { runComfyPrompt, getComfyPromptStatus } from './runs.js';

function assertComfyEnabled() {
  if (!isComfyEnabled()) {
    throw new ComfyClientError('ComfyUI integration is disabled (set COMFY_ENABLED=true)', {
      code: 'COMFY_DISABLED',
      status: 404,
    });
  }
}

function getComfyCapabilities() {
  return {
    enabled: isComfyEnabled(),
    base_url: process.env.COMFY_BASE_URL || null,
    auth_mode: process.env.COMFY_BEARER_TOKEN ? 'bearer' : process.env.COMFY_API_KEY ? 'api_key' : 'none',
  };
}

function listComfyWorkflows({ includeWorkflow = false } = {}) {
  assertComfyEnabled();
  if (includeWorkflow) {
    return listWorkflowEntries();
  }
  return listWorkflowSummaries();
}

function upsertComfyWorkflow(payload) {
  assertComfyEnabled();
  return upsertWorkflowEntry(payload);
}

function deleteComfyWorkflow(name) {
  assertComfyEnabled();
  return deleteWorkflowEntry(name);
}

function resolveWorkflowFromRequest({ workflow_name, workflow, format, inputs }) {
  if (workflow_name) {
    const entry = getWorkflowEntry(workflow_name);
    if (!entry) {
      throw new ComfyClientError(`Workflow "${workflow_name}" not found`, {
        code: 'COMFY_WORKFLOW_NOT_FOUND',
        status: 404,
      });
    }

    return {
      workflow: entry.workflow,
      format: format || entry.format,
      inputs: {
        ...(entry.defaults || {}),
        ...(inputs || {}),
      },
    };
  }

  return {
    workflow,
    format,
    inputs: inputs || {},
  };
}

async function runComfyWorkflow(payload) {
  assertComfyEnabled();
  const resolved = resolveWorkflowFromRequest(payload);

  return runComfyPrompt({
    workflow: resolved.workflow,
    format: resolved.format,
    inputs: resolved.inputs,
    wait: payload.wait,
    timeoutMs: payload.timeout_ms,
    promptId: payload.prompt_id,
    extraData: payload.extra_data,
  });
}

async function getComfyRunStatus(runId) {
  assertComfyEnabled();
  return getComfyPromptStatus(runId);
}

async function verifyComfyConnection() {
  assertComfyEnabled();
  const client = createComfyClient();
  return client.request('/prompt', { allow404: true });
}

export {
  ComfyClientError,
  isComfyEnabled,
  getComfyCapabilities,
  listComfyWorkflows,
  upsertComfyWorkflow,
  deleteComfyWorkflow,
  runComfyWorkflow,
  getComfyRunStatus,
  verifyComfyConnection,
};
