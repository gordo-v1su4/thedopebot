function envEnabled(value) {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function trimSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function authHeaders() {
  const headers = {};
  if (process.env.COMFY_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.COMFY_BEARER_TOKEN}`;
  } else if (process.env.COMFY_API_KEY) {
    headers['X-API-KEY'] = process.env.COMFY_API_KEY;
  }
  return headers;
}

class ComfyClientError extends Error {
  constructor(message, { status = null, code = 'COMFY_CLIENT_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ComfyClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class ComfyClient {
  constructor({ baseUrl, timeoutMs = 15000 } = {}) {
    const configured = baseUrl || process.env.COMFY_BASE_URL;
    if (!configured) {
      throw new ComfyClientError('COMFY_BASE_URL is required when ComfyUI integration is enabled', {
        code: 'COMFY_BASE_URL_REQUIRED',
      });
    }

    this.baseUrl = trimSlash(configured);
    this.timeoutMs = timeoutMs;
    this._jobsApiProbed = false;
    this._jobsApiAvailable = false;
  }

  async request(path, { method = 'GET', body, timeoutMs = this.timeoutMs, allow404 = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = {
        Accept: 'application/json',
        ...authHeaders(),
      };

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (allow404 && response.status === 404) {
        return null;
      }

      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
      }

      if (!response.ok) {
        throw new ComfyClientError(`ComfyUI request failed: ${response.status}`, {
          status: response.status,
          code: response.status === 401 ? 'COMFY_UNAUTHORIZED' : 'COMFY_HTTP_ERROR',
          details: parsed,
        });
      }

      return parsed;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new ComfyClientError(`ComfyUI request timed out after ${timeoutMs}ms`, {
          code: 'COMFY_TIMEOUT',
        });
      }

      if (err instanceof ComfyClientError) {
        throw err;
      }

      throw new ComfyClientError(err.message || 'ComfyUI request failed', {
        code: 'COMFY_NETWORK_ERROR',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async queuePrompt(prompt, { promptId, clientId, extraData } = {}) {
    const payload = { prompt };
    if (promptId) payload.prompt_id = promptId;
    if (clientId) payload.client_id = clientId;
    if (extraData && Object.keys(extraData).length > 0) payload.extra_data = extraData;

    return this.request('/prompt', {
      method: 'POST',
      body: payload,
    });
  }

  async convertWorkflow(workflow) {
    try {
      return await this.request('/workflow/convert', {
        method: 'POST',
        body: workflow,
      });
    } catch (err) {
      if (err instanceof ComfyClientError && err.status === 404) {
        throw new ComfyClientError(
          'Workflow conversion endpoint is unavailable. Install a converter endpoint or use File -> Export (API).',
          {
            status: 404,
            code: 'CONVERTER_NOT_AVAILABLE',
          }
        );
      }
      throw err;
    }
  }

  async getJob(runId) {
    if (!this._jobsApiProbed) {
      this._jobsApiProbed = true;
      const probe = await this.request('/api/jobs', { allow404: true });
      this._jobsApiAvailable = probe !== null;
      if (!this._jobsApiAvailable) {
        return null;
      }
    }

    if (!this._jobsApiAvailable) {
      return null;
    }

    return this.request(`/api/jobs/${encodeURIComponent(runId)}`, { allow404: true });
  }

  async getHistory(runId) {
    return this.request(`/history/${encodeURIComponent(runId)}`, { allow404: true });
  }

  async getQueue() {
    return this.request('/queue', { allow404: true });
  }

  buildViewUrl(item) {
    const url = new URL('/view', this.baseUrl);
    if (item?.filename) url.searchParams.set('filename', item.filename);
    if (item?.subfolder) url.searchParams.set('subfolder', item.subfolder);
    if (item?.type) url.searchParams.set('type', item.type);
    return url.toString();
  }
}

function isComfyEnabled() {
  return envEnabled(process.env.COMFY_ENABLED || 'false');
}

function createComfyClient(options = {}) {
  if (!isComfyEnabled()) {
    throw new ComfyClientError('ComfyUI integration is disabled (set COMFY_ENABLED=true)', {
      code: 'COMFY_DISABLED',
      status: 404,
    });
  }

  return new ComfyClient(options);
}

export { ComfyClient, ComfyClientError, createComfyClient, isComfyEnabled };
