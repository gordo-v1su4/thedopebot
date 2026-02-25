import { z } from 'zod';

const workflowNameSchema = z.string().trim().min(1).max(120);
const workflowObjectSchema = z.object({}).catchall(z.any());
const workflowFormatSchema = z.enum(['api', 'workflow']);

const upsertWorkflowRequestSchema = z.object({
  name: workflowNameSchema,
  workflow: workflowObjectSchema,
  format: workflowFormatSchema.optional(),
  description: z.string().max(2000).optional(),
  defaults: z.record(z.string(), z.any()).optional(),
});

const runRequestSchema = z
  .object({
    workflow_name: workflowNameSchema.optional(),
    workflow: workflowObjectSchema.optional(),
    format: workflowFormatSchema.optional(),
    inputs: z.record(z.string(), z.any()).optional(),
    wait: z.boolean().optional().default(true),
    timeout_ms: z.number().int().min(1000).max(600000).optional().default(120000),
    prompt_id: z.string().trim().min(1).optional(),
    extra_data: z.record(z.string(), z.any()).optional(),
  })
  .refine((value) => value.workflow_name || value.workflow, {
    message: 'workflow_name or workflow is required',
    path: ['workflow_name'],
  });

const runStatusQuerySchema = z.object({
  run_id: z.string().trim().min(1),
});

const deleteWorkflowQuerySchema = z.object({
  name: workflowNameSchema,
});

function parseSchema(schema, payload) {
  const result = schema.safeParse(payload);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    error: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

export {
  upsertWorkflowRequestSchema,
  runRequestSchema,
  runStatusQuerySchema,
  deleteWorkflowQuerySchema,
  parseSchema,
};
