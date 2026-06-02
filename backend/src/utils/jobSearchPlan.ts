import { PoolClient, QueryResult, QueryResultRow } from "pg";

export type JobSearchSort = "created_at" | "budget";

export interface NormalizedJobSearchQuery {
  query?: string;
  status?: string;
  tag?: string;
  sort: JobSearchSort;
  limit: number;
  cursor_created_at?: Date;
  cursor_id?: string;
  min_budget?: number;
  max_budget?: number;
  skills?: string;
  deadline_before?: Date;
}

export interface BuiltJobSearchQuery {
  sql: string;
  params: any[];
  planKey: string;
  normalizedSkills: string[];
  normalizedSearchTerm?: string;
}

const JOB_SEARCH_SELECT = `
  SELECT id, title, description, budget_usdc, milestones, client_address,
         freelancer_address, status, metadata_hash, on_chain_job_id, skills, deadline_at,
         created_at, updated_at
  FROM jobs
`;

function normalizeSearchTerm(query: NormalizedJobSearchQuery): string | undefined {
  const candidate = query.query || (query.tag && query.tag !== "all" ? query.tag : undefined);
  const trimmed = candidate?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSkills(skills?: string): string[] {
  return (skills || "")
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
}

/**
 * Builds the exact SQL used by both the public job listing route and the
 * plan-audit route. Keeping the text in one place prevents the audit endpoint
 * from drifting away from the production workload it is supposed to verify.
 */
export function buildJobSearchQuery(query: NormalizedJobSearchQuery): BuiltJobSearchQuery {
  const conditions: string[] = [];
  const params: any[] = [];
  const planParts: string[] = [];
  const addParam = (value: any): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const searchTerm = normalizeSearchTerm(query);
  const skills = normalizeSkills(query.skills);

  if (searchTerm) {
    const tsQuery = addParam(searchTerm);
    const trigramPattern = addParam(`%${searchTerm}%`);
    // Prefer the expression GIN full-text index while retaining trigram-backed
    // substring matching for partial words and legacy client behavior.
    conditions.push(`(
      to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
        @@ websearch_to_tsquery('simple', ${tsQuery})
      OR title ILIKE ${trigramPattern}
      OR description ILIKE ${trigramPattern}
    )`);
    planParts.push("text");
  }

  if (query.status) {
    conditions.push(`status = ${addParam(query.status)}`);
    planParts.push("status");
  }
  if (query.min_budget !== undefined) {
    conditions.push(`budget_usdc >= ${addParam(query.min_budget)}`);
    planParts.push("min_budget");
  }
  if (query.max_budget !== undefined) {
    conditions.push(`budget_usdc <= ${addParam(query.max_budget)}`);
    planParts.push("max_budget");
  }
  if (skills.length > 0) {
    conditions.push(`skills && ${addParam(skills)}::text[]`);
    planParts.push("skills");
  }
  if (query.deadline_before) {
    conditions.push(`deadline_at <= ${addParam(query.deadline_before)}`);
    planParts.push("deadline");
  }
  if (query.cursor_created_at && query.cursor_id) {
    conditions.push(
      `(created_at, id) < (${addParam(query.cursor_created_at)}, ${addParam(query.cursor_id)}::uuid)`
    );
    planParts.push("cursor");
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderSql =
    query.sort === "budget"
      ? "ORDER BY budget_usdc DESC, created_at DESC, id DESC"
      : "ORDER BY created_at DESC, id DESC";
  const limitPlaceholder = addParam(query.limit + 1);

  return {
    sql: `${JOB_SEARCH_SELECT}${whereSql}\n${orderSql}\nLIMIT ${limitPlaceholder}`,
    params,
    planKey: `${query.sort}:${planParts.length > 0 ? planParts.join("+") : "unfiltered"}`,
    normalizedSkills: skills,
    normalizedSearchTerm: searchTerm,
  };
}

/** Executes read-only job search in a short transaction with per-query timeout. */
export async function executeReadOnlyJobSearch<T extends QueryResultRow = any>(
  client: PoolClient,
  builtQuery: BuiltJobSearchQuery
): Promise<QueryResult<T>> {
  return client.query<T>(builtQuery.sql, builtQuery.params);
}

export function summarizePlan(planNode: any) {
  const nodeTypes: string[] = [];
  const relationScans: Array<{ nodeType: string; relation?: string; index?: string; totalCost?: number }> = [];

  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    const nodeType = node["Node Type"];
    if (nodeType) {
      nodeTypes.push(nodeType);
      if (String(nodeType).includes("Scan")) {
        relationScans.push({
          nodeType,
          relation: node["Relation Name"],
          index: node["Index Name"],
          totalCost: node["Total Cost"],
        });
      }
    }
    for (const child of node.Plans || []) {
      visit(child);
    }
  };

  visit(planNode);
  const jobsSequentialScan = relationScans.some(
    (scan) => scan.relation === "jobs" && scan.nodeType === "Seq Scan"
  );

  return {
    startupCost: planNode?.["Startup Cost"] ?? null,
    totalCost: planNode?.["Total Cost"] ?? null,
    planRows: planNode?.["Plan Rows"] ?? null,
    planWidth: planNode?.["Plan Width"] ?? null,
    nodeTypes,
    relationScans,
    jobsSequentialScan,
  };
}
