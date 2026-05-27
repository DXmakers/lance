import { z } from "zod";

/**
 * Zod schema for API parameter validation.
 */
export const ApiParamSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  description: z.string(),
});

/**
 * Zod schema for an API endpoint definition.
 */
export const ApiEndpointSchema = z.object({
  id: z.string(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string(),
  title: z.string(),
  description: z.string(),
  params: z.array(ApiParamSchema).optional(),
  requestBody: z.record(z.string(), z.any()).optional(),
  response: z.record(z.string(), z.any()).optional(),
  status: z.enum(["stable", "beta", "deprecated"]).default("stable"),
});

export type ApiEndpoint = z.infer<typeof ApiEndpointSchema>;
export type ApiParam = z.infer<typeof ApiParamSchema>;

/**
 * Mock data for initial implementation.
 * In a real scenario, this would be fetched from the backend or an OpenAPI spec.
 */
export const MOCK_API_DOCS: ApiEndpoint[] = [
  {
    id: "get-jobs",
    method: "GET",
    path: "/api/v1/jobs",
    title: "List Jobs",
    description: "Retrieve a paginated list of available jobs on the marketplace.",
    status: "stable",
    params: [
      { name: "page", type: "number", required: false, description: "Page number for pagination" },
      { name: "status", type: "string", required: false, description: "Filter by job status" },
    ],
    response: {
      jobs: [
        { id: "1", title: "Smart Contract Audit", budget: "5000 XLM", status: "open" }
      ],
      total: 100
    },
  },
  {
    id: "post-job",
    method: "POST",
    path: "/api/v1/jobs",
    title: "Create Job",
    description: "Post a new job requirement to the decentralized marketplace.",
    requestBody: {
      title: "string",
      description: "string",
      budget: "string",
      category: "string"
    },
    status: "beta",
  }
];
