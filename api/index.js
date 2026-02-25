import { createHash, timingSafeEqual } from 'crypto';
import { createJob } from '../lib/tools/create-job.js';
import { setWebhook } from '../lib/tools/telegram.js';
import { getJobStatus, fetchJobLog } from '../lib/tools/github.js';
import { getTelegramAdapter } from '../lib/channels/index.js';
import { chat, summarizeJob } from '../lib/ai/index.js';
import { createNotification } from '../lib/db/notifications.js';
import { loadTriggers } from '../lib/triggers.js';
import { verifyApiKey } from '../lib/db/api-keys.js';
import {
  ComfyClientError,
  isComfyEnabled,
  getComfyCapabilities,
  listComfyWorkflows,
  upsertComfyWorkflow,
  deleteComfyWorkflow,
  runComfyWorkflow,
  getComfyRunStatus,
} from '../lib/comfy/index.js';
import {
  upsertWorkflowRequestSchema,
  runRequestSchema,
  runStatusQuerySchema,
  deleteWorkflowQuerySchema,
  parseSchema,
} from '../lib/comfy/schema.js';

// Bot token from env, can be overridden by /telegram/register
let telegramBotToken = null;

// Cached trigger firing function (initialized on first request)
let _fireTriggers = null;

function getTelegramBotToken() {
  if (!telegramBotToken) {
    telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || null;
  }
  return telegramBotToken;
}

function getFireTriggers() {
  if (!_fireTriggers) {
    const result = loadTriggers();
    _fireTriggers = result.fireTriggers;
  }
  return _fireTriggers;
}

// Routes that have their own authentication
const PUBLIC_ROUTES = ['/telegram/webhook', '/github/webhook', '/ping'];

/**
 * Timing-safe string comparison.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Centralized auth gate for all API routes.
 * Public routes pass through; everything else requires a valid API key from the database.
 * @param {string} routePath - The route path
 * @param {Request} request - The incoming request
 * @returns {Response|null} - Error response or null if authorized
 */
function checkAuth(routePath, request) {
  if (PUBLIC_ROUTES.includes(routePath)) return null;

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const record = verifyApiKey(apiKey);
  if (!record) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

function comfyDisabledResponse() {
  return Response.json(
    {
      error: 'ComfyUI integration is disabled. Set COMFY_ENABLED=true to enable /api/comfy routes.',
      capabilities: getComfyCapabilities(),
    },
    { status: 404 }
  );
}

/**
 * Extract job ID from branch name (e.g., "job/abc123" -> "abc123")
 */
function extractJobId(branchName) {
  if (!branchName || !branchName.startsWith('job/')) return null;
  return branchName.slice(4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleWebhook(request) {
  const body = await request.json();
  const { job } = body;
  if (!job) return Response.json({ error: 'Missing job field' }, { status: 400 });

  try {
    const result = await createJob(job);
    return Response.json(result);
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Failed to create job' }, { status: 500 });
  }
}

async function handleTelegramRegister(request) {
  const body = await request.json();
  const { bot_token, webhook_url } = body;
  if (!bot_token || !webhook_url) {
    return Response.json({ error: 'Missing bot_token or webhook_url' }, { status: 400 });
  }

  try {
    const result = await setWebhook(bot_token, webhook_url, process.env.TELEGRAM_WEBHOOK_SECRET);
    telegramBotToken = bot_token;
    return Response.json({ success: true, result });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Failed to register webhook' }, { status: 500 });
  }
}

async function handleTelegramWebhook(request) {
  const botToken = getTelegramBotToken();
  if (!botToken) return Response.json({ ok: true });

  const adapter = getTelegramAdapter(botToken);
  const normalized = await adapter.receive(request);
  if (!normalized) return Response.json({ ok: true });

  // Process message asynchronously (don't block the webhook response)
  processChannelMessage(adapter, normalized).catch((err) => {
    console.error('Failed to process message:', err);
  });

  return Response.json({ ok: true });
}

/**
 * Process a normalized message through the AI layer with channel UX.
 * Message persistence is handled centrally by the AI layer.
 */
async function processChannelMessage(adapter, normalized) {
  await adapter.acknowledge(normalized.metadata);
  const stopIndicator = adapter.startProcessingIndicator(normalized.metadata);

  try {
    const response = await chat(
      normalized.threadId,
      normalized.text,
      normalized.attachments,
      { userId: 'telegram', chatTitle: 'Telegram' }
    );
    await adapter.sendResponse(normalized.threadId, response, normalized.metadata);
  } catch (err) {
    console.error('Failed to process message with AI:', err);
    await adapter
      .sendResponse(
        normalized.threadId,
        'Sorry, I encountered an error processing your message.',
        normalized.metadata
      )
      .catch(() => {});
  } finally {
    stopIndicator();
  }
}

async function handleGithubWebhook(request) {
  const { GH_WEBHOOK_SECRET } = process.env;

  // Validate webhook secret (timing-safe, required)
  if (!GH_WEBHOOK_SECRET || !safeCompare(request.headers.get('x-github-webhook-secret-token'), GH_WEBHOOK_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json();
  const jobId = payload.job_id || extractJobId(payload.branch);
  if (!jobId) return Response.json({ ok: true, skipped: true, reason: 'not a job' });

  try {
    // Fetch log from repo via API (no longer sent in payload)
    let log = payload.log || '';
    if (!log) {
      log = await fetchJobLog(jobId, payload.commit_sha);
    }

    const results = {
      job: payload.job || '',
      pr_url: payload.pr_url || payload.run_url || '',
      run_url: payload.run_url || '',
      status: payload.status || '',
      merge_result: payload.merge_result || '',
      log,
      changed_files: payload.changed_files || [],
      commit_message: payload.commit_message || '',
    };

    const message = await summarizeJob(results);
    await createNotification(message, payload);

    console.log(`Notification saved for job ${jobId.slice(0, 8)}`);

    return Response.json({ ok: true, notified: true });
  } catch (err) {
    console.error('Failed to process GitHub webhook:', err);
    return Response.json({ error: 'Failed to process webhook' }, { status: 500 });
  }
}

async function handleJobStatus(request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('job_id');
    const result = await getJobStatus(jobId);
    return Response.json(result);
  } catch (err) {
    console.error('Failed to get job status:', err);
    return Response.json({ error: 'Failed to get job status' }, { status: 500 });
  }
}

async function handleComfyWorkflowUpsert(request) {
  if (!isComfyEnabled()) return comfyDisabledResponse();

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseSchema(upsertWorkflowRequestSchema, body);
  if (!parsed.ok) {
    return Response.json({ error: 'Invalid request body', issues: parsed.error }, { status: 400 });
  }

  const workflow = upsertComfyWorkflow(parsed.data);
  return Response.json({ success: true, workflow });
}

async function handleComfyWorkflowList() {
  if (!isComfyEnabled()) return comfyDisabledResponse();
  return Response.json({
    success: true,
    workflows: listComfyWorkflows(),
  });
}

async function handleComfyWorkflowDelete(request) {
  if (!isComfyEnabled()) return comfyDisabledResponse();

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams);
  const parsed = parseSchema(deleteWorkflowQuerySchema, query);
  if (!parsed.ok) {
    return Response.json({ error: 'Invalid query parameters', issues: parsed.error }, { status: 400 });
  }

  const result = deleteComfyWorkflow(parsed.data.name);
  if (!result.deleted) {
    return Response.json({ error: `Workflow "${parsed.data.name}" not found` }, { status: 404 });
  }

  return Response.json({ success: true, deleted: true, workflow: result.workflow });
}

async function handleComfyRunCreate(request) {
  if (!isComfyEnabled()) return comfyDisabledResponse();

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseSchema(runRequestSchema, body);
  if (!parsed.ok) {
    return Response.json({ error: 'Invalid request body', issues: parsed.error }, { status: 400 });
  }

  try {
    const result = await runComfyWorkflow(parsed.data);
    return Response.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ComfyClientError) {
      return Response.json(
        {
          error: err.message,
          code: err.code,
          details: err.details || null,
        },
        { status: err.status || 500 }
      );
    }

    console.error('Failed to create Comfy run:', err);
    return Response.json({ error: 'Failed to create Comfy run' }, { status: 500 });
  }
}

async function handleComfyRunStatus(request) {
  if (!isComfyEnabled()) return comfyDisabledResponse();

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams);
  const parsed = parseSchema(runStatusQuerySchema, query);
  if (!parsed.ok) {
    return Response.json({ error: 'Invalid query parameters', issues: parsed.error }, { status: 400 });
  }

  try {
    const status = await getComfyRunStatus(parsed.data.run_id);
    return Response.json({ success: true, ...status });
  } catch (err) {
    if (err instanceof ComfyClientError) {
      return Response.json(
        {
          error: err.message,
          code: err.code,
          details: err.details || null,
        },
        { status: err.status || 500 }
      );
    }

    console.error('Failed to get Comfy run status:', err);
    return Response.json({ error: 'Failed to get Comfy run status' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Next.js Route Handlers (catch-all)
// ─────────────────────────────────────────────────────────────────────────────

async function POST(request) {
  const url = new URL(request.url);
  const routePath = url.pathname.replace(/^\/api/, '');

  // Auth check
  const authError = checkAuth(routePath, request);
  if (authError) return authError;

  // Fire triggers (non-blocking)
  try {
    const fireTriggers = getFireTriggers();
    // Clone request to read body for triggers without consuming it for the handler
    const clonedRequest = request.clone();
    const body = await clonedRequest.json().catch(() => ({}));
    const query = Object.fromEntries(url.searchParams);
    const headers = Object.fromEntries(request.headers);
    fireTriggers(routePath, body, query, headers);
  } catch (e) {
    // Trigger errors are non-fatal
  }

  // Route to handler
  switch (routePath) {
    case '/create-job':          return handleWebhook(request);
    case '/telegram/webhook':   return handleTelegramWebhook(request);
    case '/telegram/register':  return handleTelegramRegister(request);
    case '/github/webhook':     return handleGithubWebhook(request);
    case '/comfy/workflows/upsert': return handleComfyWorkflowUpsert(request);
    case '/comfy/runs':         return handleComfyRunCreate(request);
    default:                    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

async function GET(request) {
  const url = new URL(request.url);
  const routePath = url.pathname.replace(/^\/api/, '');

  // Auth check
  const authError = checkAuth(routePath, request);
  if (authError) return authError;

  switch (routePath) {
    case '/ping':           return Response.json({ message: 'Pong!' });
    case '/jobs/status':    return handleJobStatus(request);
    case '/comfy/workflows': return handleComfyWorkflowList();
    case '/comfy/runs/status': return handleComfyRunStatus(request);
    default:                return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

async function DELETE(request) {
  const url = new URL(request.url);
  const routePath = url.pathname.replace(/^\/api/, '');

  const authError = checkAuth(routePath, request);
  if (authError) return authError;

  switch (routePath) {
    case '/comfy/workflows': return handleComfyWorkflowDelete(request);
    default:                return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

export { GET, POST, DELETE };
