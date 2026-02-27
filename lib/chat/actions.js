'use server';

import { auth } from '../auth/index.js';
import {
  createChat as dbCreateChat,
  getChatById,
  getMessagesByChatId,
  deleteChat as dbDeleteChat,
  deleteAllChatsByUser,
  updateChatTitle,
  toggleChatStarred,
} from '../db/chats.js';
import {
  getNotifications as dbGetNotifications,
  getUnreadCount as dbGetUnreadCount,
  markAllRead as dbMarkAllRead,
} from '../db/notifications.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CACHE_TTL_MS = 15 * 60 * 1000;
let openRouterCache = null;
const CAPABILITY_KEYS = ['supportsVision', 'supportsVideo', 'supportsImageGeneration', 'supportsReasoning', 'supportsTools'];
const CAPABILITY_OVERRIDE_RULES = [
  {
    name: 'openai-gpt-image',
    test: /^openai\/gpt[-_]?image/i,
    set: { supportsImageGeneration: true, supportsVision: true, supportsVideo: false, supportsReasoning: false },
  },
  {
    name: 'google-imagen',
    test: /^google\/imagen/i,
    set: { supportsImageGeneration: true, supportsVision: true, supportsVideo: false, supportsReasoning: false },
  },
  {
    name: 'nano-banana',
    test: /nano[-_ ]banana/i,
    set: { supportsImageGeneration: true, supportsVision: true, supportsVideo: false },
  },
  {
    name: 'video-gen-families',
    test: /(veo|sora|kling|runway|pika|luma|hailuo|vidu|wan-?2\.2|video[-_ ]gen|minimax\/video|seedance)/i,
    set: { supportsVideo: true },
  },
  {
    name: 'explicit-thinking',
    test: /(thinking|reasoning|reasoner|r1|o1|o3|o4-mini)/i,
    set: { supportsReasoning: true },
  },
  {
    name: 'openai-gpt-oss',
    test: /^openai\/gpt-oss/i,
    set: { supportsReasoning: true },
  },
  {
    name: 'claude-thinking',
    test: /^anthropic\/.*(thinking|claude-3\.7|claude-4)/i,
    set: { supportsReasoning: true, supportsTools: true },
  },
  {
    name: 'gemini-thinking',
    test: /^google\/gemini.*thinking/i,
    set: { supportsReasoning: true },
  },
];

function parseNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function toPerMillion(value) {
  const n = parseNumber(value);
  return n == null ? null : n * 1_000_000;
}

function applyCapabilityOverrides(model) {
  const next = { ...model };
  for (const rule of CAPABILITY_OVERRIDE_RULES) {
    if (!rule.test.test(model.id)) continue;
    for (const key of CAPABILITY_KEYS) {
      if (key in rule.set) {
        next[key] = Boolean(rule.set[key]);
      }
    }
  }
  return next;
}

function normalizeOpenRouterModels(rawModels = []) {
  const normalized = rawModels
    .map((model) => {
      const promptPerM = toPerMillion(model?.pricing?.prompt);
      const completionPerM = toPerMillion(model?.pricing?.completion);
      const requestPerM = toPerMillion(model?.pricing?.request);
      const hasAnyPrice = promptPerM != null || completionPerM != null || requestPerM != null;
      const totalPerM = hasAnyPrice
        ? (promptPerM || 0) + (completionPerM || 0) + (requestPerM || 0)
        : Number.POSITIVE_INFINITY;
      const contextLength = Number(model?.context_length) || 0;
      const id = model?.id;
      if (!id || typeof id !== 'string') return null;
      const description = model?.description || '';
      const supported = Array.isArray(model?.supported_parameters) ? model.supported_parameters : [];
      const inputModalities = Array.isArray(model?.architecture?.input_modalities)
        ? model.architecture.input_modalities
        : [];
      const outputModalities = Array.isArray(model?.architecture?.output_modalities)
        ? model.architecture.output_modalities
        : [];
      const modality = String(model?.architecture?.modality || '').toLowerCase();
      const loweredId = id.toLowerCase();
      const loweredDesc = description.toLowerCase();
      const provider = id.includes('/') ? id.split('/')[0] : 'unknown';

      const isFree =
        id.endsWith(':free') ||
        (hasAnyPrice &&
          (promptPerM == null || promptPerM === 0) &&
          (completionPerM == null || completionPerM === 0) &&
          (requestPerM == null || requestPerM === 0));

      const supportsVision =
        inputModalities.includes('image') ||
        inputModalities.includes('video') ||
        modality.includes('image') ||
        modality.includes('video');
      const supportsVideo =
        inputModalities.includes('video') ||
        outputModalities.includes('video') ||
        modality.includes('video') ||
        loweredId.includes('video') ||
        loweredId.includes('veo') ||
        loweredId.includes('sora') ||
        loweredDesc.includes('video generation');
      const supportsImageGeneration =
        outputModalities.includes('image') ||
        modality.includes('->image') ||
        loweredId.includes('image') ||
        loweredId.includes('imagen') ||
        loweredDesc.includes('image generation');
      const supportsReasoning =
        supported.includes('reasoning') ||
        supported.includes('include_reasoning') ||
        loweredId.includes('reason') ||
        loweredId.includes('thinking') ||
        loweredDesc.includes('reasoning') ||
        loweredDesc.includes('thinking');
      const supportsTools =
        supported.includes('tools') ||
        supported.includes('tool_choice') ||
        loweredDesc.includes('tool use');

      return applyCapabilityOverrides({
        id,
        name: model?.name || id,
        provider,
        description,
        contextLength,
        promptPerM,
        completionPerM,
        requestPerM,
        totalPerM,
        isFree,
        supportsVision,
        supportsVideo,
        supportsImageGeneration,
        supportsReasoning,
        supportsTools,
      });
    })
    .filter(Boolean);

  normalized.sort((a, b) => {
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
    if (a.isFree && b.isFree) {
      if (a.contextLength !== b.contextLength) return b.contextLength - a.contextLength;
      return a.id.localeCompare(b.id);
    }
    if (a.totalPerM !== b.totalPerM) return a.totalPerM - b.totalPerM;
    if (a.contextLength !== b.contextLength) return b.contextLength - a.contextLength;
    return a.id.localeCompare(b.id);
  });

  return normalized;
}

/**
 * Get the authenticated user or throw.
 */
async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  return session.user;
}

/**
 * Get all chats for the authenticated user (includes Telegram chats).
 * @returns {Promise<object[]>}
 */
export async function getChats() {
  const user = await requireAuth();
  const { or, eq, desc } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats } = await import('../db/schema.js');
  const db = getDb();
  return db
    .select()
    .from(chats)
    .where(or(eq(chats.userId, user.id), eq(chats.userId, 'telegram')))
    .orderBy(desc(chats.updatedAt))
    .all();
}

/**
 * Get messages for a specific chat (with ownership check).
 * @param {string} chatId
 * @returns {Promise<object[]>}
 */
export async function getChatMessages(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || (chat.userId !== user.id && chat.userId !== 'telegram')) {
    return [];
  }
  return getMessagesByChatId(chatId);
}

/**
 * Create a new chat.
 * @param {string} [id] - Optional chat ID
 * @param {string} [title='New Chat']
 * @returns {Promise<object>}
 */
export async function createChat(id, title = 'New Chat') {
  const user = await requireAuth();
  return dbCreateChat(user.id, title, id);
}

/**
 * Delete a chat (with ownership check).
 * @param {string} chatId
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteChat(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }
  dbDeleteChat(chatId);
  return { success: true };
}

/**
 * Rename a chat (with ownership check).
 * @param {string} chatId
 * @param {string} title
 * @returns {Promise<{success: boolean}>}
 */
export async function renameChat(chatId, title) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }
  updateChatTitle(chatId, title);
  return { success: true };
}

/**
 * Toggle a chat's starred status (with ownership check).
 * @param {string} chatId
 * @returns {Promise<{success: boolean, starred?: number}>}
 */
export async function starChat(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }
  const starred = toggleChatStarred(chatId);
  return { success: true, starred };
}

/**
 * Delete all chats for the authenticated user.
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteAllChats() {
  const user = await requireAuth();
  deleteAllChatsByUser(user.id);
  return { success: true };
}

/**
 * Get all notifications, newest first.
 * @returns {Promise<object[]>}
 */
export async function getNotifications() {
  await requireAuth();
  return dbGetNotifications();
}

/**
 * Get count of unread notifications.
 * @returns {Promise<number>}
 */
export async function getUnreadNotificationCount() {
  await requireAuth();
  return dbGetUnreadCount();
}

/**
 * Mark all notifications as read.
 * @returns {Promise<{success: boolean}>}
 */
export async function markNotificationsRead() {
  await requireAuth();
  dbMarkAllRead();
  return { success: true };
}

/**
 * Fetch OpenRouter models, sorted free-first then by price.
 * Returns enough metadata for a client dropdown.
 * @returns {Promise<object>}
 */
export async function getOpenRouterModels(options = {}) {
  await requireAuth();
  const forceRefresh = Boolean(options?.forceRefresh);

  const provider = process.env.LLM_PROVIDER || 'anthropic';
  const baseUrl = process.env.OPENAI_BASE_URL || '';
  const apiKey = process.env.CUSTOM_API_KEY || process.env.OPENAI_API_KEY || '';
  const usingOpenAICompatibleProvider = provider === 'custom' || provider === 'openai';
  const enabled = usingOpenAICompatibleProvider && baseUrl.includes('openrouter.ai');

  if (!enabled) {
    return {
      enabled: false,
      provider,
      baseUrl,
      defaultModel: process.env.LLM_MODEL || null,
      models: [],
      recommendedModel: null,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
  }

  const now = Date.now();
  if (!forceRefresh && openRouterCache && now - openRouterCache.ts < OPENROUTER_CACHE_TTL_MS) {
    return openRouterCache.payload;
  }

  if (!apiKey) {
    return {
      enabled: true,
      provider,
      baseUrl,
      defaultModel: process.env.LLM_MODEL || null,
      models: [],
      recommendedModel: null,
      fetchedAt: new Date().toISOString(),
      error: 'OPENAI_API_KEY (or CUSTOM_API_KEY) is not configured for OpenRouter.',
    };
  }

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return {
        enabled: true,
        provider,
        baseUrl,
        defaultModel: process.env.LLM_MODEL || null,
        models: [],
        recommendedModel: null,
        fetchedAt: new Date().toISOString(),
        error: `OpenRouter model query failed (${res.status}).`,
      };
    }

    const json = await res.json();
    const models = normalizeOpenRouterModels(json?.data || []);
    const recommendedModel = models.find((m) => m.isFree)?.id || models[0]?.id || null;

    const payload = {
      enabled: true,
      provider,
      baseUrl,
      defaultModel: process.env.LLM_MODEL || null,
      models,
      recommendedModel,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
    openRouterCache = { ts: now, payload };
    return payload;
  } catch (err) {
    return {
      enabled: true,
      provider,
      baseUrl,
      defaultModel: process.env.LLM_MODEL || null,
      models: [],
      recommendedModel: null,
      fetchedAt: new Date().toISOString(),
      error: `OpenRouter model query failed: ${err.message}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// App info actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the installed package version and update status (auth-gated, never in client bundle).
 * @returns {Promise<{ version: string, updateAvailable: string|null }>}
 */
export async function getAppVersion() {
  await requireAuth();
  const { getInstalledVersion } = await import('../cron.js');
  const { getAvailableVersion, getReleaseNotes } = await import('../db/update-check.js');
  return {
    version: getInstalledVersion(),
    updateAvailable: getAvailableVersion(),
    changelog: getReleaseNotes(),
  };
}

/**
 * Trigger the upgrade-event-handler workflow via GitHub Actions.
 * @returns {Promise<{ success: boolean }>}
 */
export async function triggerUpgrade() {
  await requireAuth();
  const { triggerWorkflowDispatch } = await import('../tools/github.js');
  const { getAvailableVersion } = await import('../db/update-check.js');
  const targetVersion = getAvailableVersion();
  await triggerWorkflowDispatch('upgrade-event-handler.yml', 'main', {
    target_version: targetVersion || '',
  });
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// API Key actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create (or replace) the API key.
 * @returns {Promise<{ key: string, record: object } | { error: string }>}
 */
export async function createNewApiKey() {
  const user = await requireAuth();
  try {
    const { createApiKeyRecord } = await import('../db/api-keys.js');
    return createApiKeyRecord(user.id);
  } catch (err) {
    console.error('Failed to create API key:', err);
    return { error: 'Failed to create API key' };
  }
}

/**
 * Get the current API key metadata (no hash).
 * @returns {Promise<object|null>}
 */
export async function getApiKeys() {
  await requireAuth();
  try {
    const { getApiKey } = await import('../db/api-keys.js');
    return getApiKey();
  } catch (err) {
    console.error('Failed to get API key:', err);
    return null;
  }
}

/**
 * Delete the API key.
 * @returns {Promise<{ success: boolean } | { error: string }>}
 */
export async function deleteApiKey() {
  await requireAuth();
  try {
    const mod = await import('../db/api-keys.js');
    mod.deleteApiKey();
    return { success: true };
  } catch (err) {
    console.error('Failed to delete API key:', err);
    return { error: 'Failed to delete API key' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Swarm actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get swarm status (active + completed jobs with counts).
 * @returns {Promise<object>}
 */
export async function getSwarmStatus(page = 1) {
  await requireAuth();
  try {
    const { getSwarmStatus: fetchStatus } = await import('../tools/github.js');
    return await fetchStatus(page);
  } catch (err) {
    console.error('Failed to get swarm status:', err);
    return { error: 'Failed to get swarm status', runs: [], hasMore: false };
  }
}

/**
 * Get swarm config (crons + triggers).
 * @returns {Promise<{ crons: object[], triggers: object[] }>}
 */
export async function getSwarmConfig() {
  await requireAuth();
  const { cronsFile, triggersFile } = await import('../paths.js');
  const fs = await import('fs');
  let crons = [];
  let triggers = [];
  try { crons = JSON.parse(fs.readFileSync(cronsFile, 'utf8')); } catch {}
  try { triggers = JSON.parse(fs.readFileSync(triggersFile, 'utf8')); } catch {}
  return { crons, triggers };
}
