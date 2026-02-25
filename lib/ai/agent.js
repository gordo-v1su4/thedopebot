import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage } from '@langchain/core/messages';
import { createModel } from './model.js';
import { createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool, getPiSkillCreationGuideTool } from './tools.js';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { eventHandlerMd, thepopebotDb } from '../paths.js';
import { render_md } from '../utils/render-md.js';

let _agent = null;
const _agentCache = new Map();

/**
 * Get or create the LangGraph agent singleton.
 * Uses createReactAgent which handles the tool loop automatically.
 * Prompt is a function so {{datetime}} resolves fresh each invocation.
 */
export async function getAgent(options = {}) {
  const provider = options.provider || process.env.LLM_PROVIDER || 'anthropic';
  const modelName = options.model || process.env.LLM_MODEL || '';
  const cacheKey = `${provider}::${modelName}`;

  if (!_agentCache.has(cacheKey)) {
    const model = await createModel({ provider, model: options.model });
    const tools = [createJobTool, getJobStatusTool, getSystemTechnicalSpecsTool, getPiSkillCreationGuideTool];
    const checkpointer = SqliteSaver.fromConnString(thepopebotDb);

    const agent = createReactAgent({
      llm: model,
      tools,
      checkpointSaver: checkpointer,
      prompt: (state) => [new SystemMessage(render_md(eventHandlerMd)), ...state.messages],
    });
    _agentCache.set(cacheKey, agent);
  }

  const cached = _agentCache.get(cacheKey);
  _agent = cached;
  return cached;
}

/**
 * Reset the agent singleton (e.g., when config changes).
 */
export function resetAgent() {
  _agent = null;
  _agentCache.clear();
}
