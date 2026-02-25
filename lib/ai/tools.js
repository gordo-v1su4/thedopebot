import fs from 'fs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createJob } from '../tools/create-job.js';
import { getJobStatus } from '../tools/github.js';
import { claudeMd, skillGuidePath } from '../paths.js';
import {
  isComfyEnabled,
  listComfyWorkflows,
  runComfyWorkflow,
  getComfyRunStatus,
} from '../comfy/index.js';

const createJobTool = tool(
  async ({ job_description }) => {
    const result = await createJob(job_description);
    return JSON.stringify({
      success: true,
      job_id: result.job_id,
      branch: result.branch,
    });
  },
  {
    name: 'create_job',
    description:
      'Create an autonomous job that runs a Docker agent in a container. The Docker agent has full filesystem access, web search, browser automation, and other abilities. The job description you provide becomes the Docker agent\'s task prompt. Returns the job ID and branch name.',
    schema: z.object({
      job_description: z
        .string()
        .describe(
          'Detailed job description including context and requirements. Be specific about what needs to be done.'
        ),
    }),
  }
);

const getJobStatusTool = tool(
  async ({ job_id }) => {
    const result = await getJobStatus(job_id);
    return JSON.stringify(result);
  },
  {
    name: 'get_job_status',
    description:
      'Check status of running jobs. Returns list of active workflow runs with timing and current step. Use when user asks about job progress, running jobs, or job status.',
    schema: z.object({
      job_id: z
        .string()
        .optional()
        .describe(
          'Optional: specific job ID to check. If omitted, returns all running jobs.'
        ),
    }),
  }
);

const getSystemTechnicalSpecsTool = tool(
  async () => {
    try {
      return fs.readFileSync(claudeMd, 'utf8');
    } catch {
      return 'No technical documentation found (CLAUDE.md not present in project root).';
    }
  },
  {
    name: 'get_system_technical_specs',
    description:
      'Read the system architecture and technical documentation (CLAUDE.md). Use this when you need to understand how the system itself works — the event handler, Docker agent, API routes, database, cron/trigger configuration, GitHub Actions, deployment, or file structure. Use this before planning jobs that modify system configuration or infrastructure. NOT for Pi skill creation (use get_pi_skill_creation_guide for that).',
    schema: z.object({}),
  }
);

const getPiSkillCreationGuideTool = tool(
  async () => {
    try {
      return fs.readFileSync(skillGuidePath, 'utf8');
    } catch {
      return 'Skill guide not found.';
    }
  },
  {
    name: 'get_pi_skill_creation_guide',
    description:
      'Load the guide for creating, modifying, and understanding Pi agent skills (pi-skills). Use this when the user wants to create a new skill, asks how skills work, wants to modify an existing skill, or when you need to understand the skill format (SKILL.md, {baseDir}, activation, testing). This is about Pi skills specifically — the lightweight bash/Node.js wrappers that extend what the Docker agent can do. NOT for understanding the system architecture (use get_system_technical_specs for that).',
    schema: z.object({}),
  }
);

const comfyListWorkflowsTool = tool(
  async () => {
    const workflows = listComfyWorkflows();
    return JSON.stringify({
      success: true,
      workflows,
      count: workflows.length,
    });
  },
  {
    name: 'comfy_list_workflows',
    description:
      'List configured ComfyUI workflows from config/COMFY_WORKFLOWS.json. Use this before running Comfy generations.',
    schema: z.object({}),
  }
);

const comfyRunWorkflowTool = tool(
  async ({ workflow_name, inputs, wait, timeout_seconds }) => {
    const result = await runComfyWorkflow({
      workflow_name,
      inputs,
      wait,
      timeout_ms: timeout_seconds ? timeout_seconds * 1000 : undefined,
    });
    return JSON.stringify({
      success: true,
      ...result,
    });
  },
  {
    name: 'comfy_run_workflow',
    description:
      'Run a configured ComfyUI workflow by name. Supports optional input overrides and synchronous waiting for completion.',
    schema: z.object({
      workflow_name: z.string().describe('Workflow name from comfy_list_workflows.'),
      inputs: z
        .record(z.string(), z.any())
        .optional()
        .describe('Optional input overrides. Supports node-id maps and dot-paths like "6.inputs.text".'),
      wait: z
        .boolean()
        .optional()
        .describe('Wait for completion before returning. Defaults to true.'),
      timeout_seconds: z
        .number()
        .int()
        .min(5)
        .max(600)
        .optional()
        .describe('Maximum seconds to wait when wait=true.'),
    }),
  }
);

const comfyGetRunStatusTool = tool(
  async ({ run_id }) => {
    const status = await getComfyRunStatus(run_id);
    return JSON.stringify({
      success: true,
      ...status,
    });
  },
  {
    name: 'comfy_get_run_status',
    description:
      'Check the status of a ComfyUI run by run_id/prompt_id. Returns pending, in_progress, completed, or failed with artifacts when available.',
    schema: z.object({
      run_id: z.string().describe('Run ID (Comfy prompt_id).'),
    }),
  }
);

function getOptionalComfyTools() {
  if (!isComfyEnabled()) return [];
  return [comfyListWorkflowsTool, comfyRunWorkflowTool, comfyGetRunStatusTool];
}

export {
  createJobTool,
  getJobStatusTool,
  getSystemTechnicalSpecsTool,
  getPiSkillCreationGuideTool,
  getOptionalComfyTools,
};
