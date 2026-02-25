import { randomUUID } from 'crypto';
import { createComfyClient, ComfyClientError } from './client.js';
import { detectWorkflowFormat } from './workflows.js';

const TERMINAL_STATES = new Set(['completed', 'failed']);

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function setByPath(target, path, value) {
  const parts = path.split('.');
  let current = target;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!isObject(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

function applyInputs(prompt, inputs = {}) {
  const cloned = structuredClone(prompt);

  for (const [key, value] of Object.entries(inputs)) {
    if (key.includes('.')) {
      setByPath(cloned, key, value);
      continue;
    }

    if (isObject(cloned[key]) && isObject(cloned[key].inputs) && isObject(value)) {
      cloned[key].inputs = {
        ...cloned[key].inputs,
        ...value,
      };
      continue;
    }

    cloned[key] = value;
  }

  return cloned;
}

function normalizeState(status) {
  switch ((status || '').toLowerCase()) {
    case 'completed':
    case 'success':
      return 'completed';
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'failed';
    case 'in_progress':
    case 'running':
      return 'in_progress';
    case 'pending':
    case 'queued':
    default:
      return 'pending';
  }
}

function normalizeOutputItem(item, mediaType) {
  if (!item || typeof item !== 'object') return null;
  if (!item.filename) return null;

  return {
    filename: item.filename,
    subfolder: item.subfolder || '',
    type: item.type || 'output',
    media_type: item.mediaType || mediaType,
    format: item.format || null,
  };
}

function collectArtifacts(outputs, client) {
  const artifacts = [];

  if (!outputs || typeof outputs !== 'object') {
    return artifacts;
  }

  for (const [nodeId, nodeOutputs] of Object.entries(outputs)) {
    if (!nodeOutputs || typeof nodeOutputs !== 'object') continue;

    for (const [mediaType, mediaItems] of Object.entries(nodeOutputs)) {
      if (mediaType === 'animated' || !Array.isArray(mediaItems)) continue;

      for (const item of mediaItems) {
        const normalized = normalizeOutputItem(item, mediaType);
        if (!normalized) continue;

        artifacts.push({
          ...normalized,
          node_id: nodeId,
          view_url: client.buildViewUrl(normalized),
        });
      }
    }
  }

  return artifacts;
}

function normalizeJobsApiStatus(job, runId, client) {
  const artifacts = collectArtifacts(job.outputs, client);
  return {
    run_id: runId,
    status: normalizeState(job.status),
    source: 'jobs_api',
    created_at: job.create_time || null,
    execution_start_time: job.execution_start_time || null,
    execution_end_time: job.execution_end_time || null,
    error: job.execution_error || null,
    outputs_count: job.outputs_count ?? artifacts.length,
    artifacts,
  };
}

function normalizeHistoryStatus(historyItem, runId, client) {
  const statusStr = historyItem?.status?.status_str || '';
  const artifacts = collectArtifacts(historyItem?.outputs, client);

  let createdAt = null;
  if (Array.isArray(historyItem?.prompt) && historyItem.prompt[3]?.create_time) {
    createdAt = historyItem.prompt[3].create_time;
  }

  return {
    run_id: runId,
    status: normalizeState(statusStr),
    source: 'history',
    created_at: createdAt,
    execution_start_time: null,
    execution_end_time: null,
    error: statusStr === 'error' ? historyItem?.status || null : null,
    outputs_count: artifacts.length,
    artifacts,
  };
}

async function resolvePromptStatus(runId, client) {
  const job = await client.getJob(runId);
  if (job) {
    return normalizeJobsApiStatus(job, runId, client);
  }

  const history = await client.getHistory(runId);
  if (history && history[runId]) {
    return normalizeHistoryStatus(history[runId], runId, client);
  }

  const queue = await client.getQueue();
  if (queue) {
    const running = Array.isArray(queue.queue_running) && queue.queue_running.some((item) => item?.[1] === runId);
    if (running) {
      return {
        run_id: runId,
        status: 'in_progress',
        source: 'queue',
        outputs_count: 0,
        artifacts: [],
      };
    }

    const pending = Array.isArray(queue.queue_pending) && queue.queue_pending.some((item) => item?.[1] === runId);
    if (pending) {
      return {
        run_id: runId,
        status: 'pending',
        source: 'queue',
        outputs_count: 0,
        artifacts: [],
      };
    }
  }

  return {
    run_id: runId,
    status: 'pending',
    source: 'unknown',
    outputs_count: 0,
    artifacts: [],
  };
}

async function resolveApiPrompt(workflow, format, client) {
  const finalFormat = format || detectWorkflowFormat(workflow);
  if (finalFormat === 'api') {
    return workflow;
  }

  if (finalFormat === 'workflow') {
    return client.convertWorkflow(workflow);
  }

  return workflow;
}

async function runComfyPrompt({ workflow, format, inputs, wait = true, timeoutMs = 120000, promptId, extraData }) {
  const client = createComfyClient();
  const apiPrompt = await resolveApiPrompt(workflow, format, client);
  const prompt = applyInputs(apiPrompt, inputs);

  const queueResponse = await client.queuePrompt(prompt, {
    promptId,
    clientId: randomUUID(),
    extraData,
  });

  const runId = queueResponse?.prompt_id || promptId;
  if (!runId) {
    throw new ComfyClientError('ComfyUI did not return prompt_id for queued run', {
      code: 'COMFY_NO_PROMPT_ID',
    });
  }

  if (!wait) {
    return {
      run_id: runId,
      status: 'pending',
      queued: true,
      queue_response: queueResponse,
    };
  }

  const started = Date.now();
  let latest = {
    run_id: runId,
    status: 'pending',
    source: 'queue',
    outputs_count: 0,
    artifacts: [],
  };

  while (Date.now() - started < timeoutMs) {
    latest = await resolvePromptStatus(runId, client);
    if (TERMINAL_STATES.has(latest.status)) {
      return {
        ...latest,
        timed_out: false,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return {
    ...latest,
    timed_out: true,
    timeout_ms: timeoutMs,
  };
}

async function getComfyPromptStatus(runId) {
  const client = createComfyClient();
  return resolvePromptStatus(runId, client);
}

export {
  runComfyPrompt,
  getComfyPromptStatus,
};
