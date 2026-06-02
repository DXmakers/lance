import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { trace } from "../config/tracing";
import { z } from "zod";

const router = Router();
const logger = trace.getLogger("users-routes");

// Pagination schema for all address mapping queries
const paginationSchema = z.object({
  page: z.string().optional().default("1").transform(v => Math.max(1, parseInt(v, 10) || 1)),
  limit: z.string().optional().default("50").transform(v => {
    const parsed = parseInt(v, 10) || 50;
    return Math.min(Math.max(1, parsed), 100); // Enforce 1-100 limit
  }),
});

type PaginationParams = z.infer<typeof paginationSchema>;

const updateProfileSchema = z.object({
  display_name: z.string().optional().nullable(),
  headline: z.string().optional().default(""),
  bio: z.string().optional().default(""),
  portfolio_links: z.array(z.string()).optional().default([]),
});

// GET /api/v1/users - List all user addresses with pagination
router.get("/", async (req: Request, res: Response) => {
  const startTime = Date.now();
  logger.debug("GET /users request received", { query: req.query });

  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const skip = (page - 1) * limit;

    logger.info("Fetching paginated user addresses", { page, limit, skip });

    const [users, total] = await Promise.all([
      prisma.profiles.findMany({
        select: { address: true },
        distinct: ["address"],
        orderBy: { address: "asc" },
        skip,
        take: limit,
      }),
      prisma.profiles.count(),
    ]);

    const duration = Date.now() - startTime;
    logger.info("User addresses fetched successfully", {
      count: users.length,
      total,
      page,
      limit,
      duration,
    });

    res.status(200).json({
      data: users.map(u => u.address),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("GET /users error", {
      error: error instanceof Error ? error.message : String(error),
      duration,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/users/:address/profile
router.get("/:address/profile", async (req: Request<{ address: string }>, res: Response) => {
  const startTime = Date.now();
  const { address } = req.params;
  logger.debug("GET /users/:address/profile request", { address });

  try {
    const profile = await prisma.profiles.findUnique({
      where: { address },
    });

    const completedJobs = await prisma.jobs.findMany({
      where: {
        OR: [{ client_address: address }, { freelancer_address: address }],
        status: "completed",
      },
      orderBy: { updated_at: "desc" },
      take: 24,
    });

    const history = completedJobs.map(job => {
      const isClient = job.client_address === address;
      return {
        job_id: job.id,
        title: job.title,
        budget_usdc: Number(job.budget_usdc),
        role: isClient ? "client" : "freelancer",
        counterparty: isClient ? (job.freelancer_address || "unassigned") : job.client_address,
        status: job.status,
        completed_at: job.updated_at,
      };
    });

    const allUserJobs = await prisma.jobs.findMany({
      where: {
        OR: [{ client_address: address }, { freelancer_address: address }],
      }
    });

    const total_jobs = allUserJobs.length;
    const completed_jobs = allUserJobs.filter(j => j.status === "completed").length;
    const active_jobs = allUserJobs.filter(j => ["awaiting_funding", "funded", "in_progress", "deliverable_submitted"].includes(j.status)).length;
    const disputed_jobs = allUserJobs.filter(j => j.status === "disputed").length;
    
    let verified_volume_usdc = 0;
    allUserJobs.filter(j => j.status === "completed").forEach(j => {
      verified_volume_usdc += Number(j.budget_usdc);
    });

    const completion_rate = total_jobs === 0 ? 0 : completed_jobs / total_jobs;
    const dispute_rate = total_jobs === 0 ? 0 : disputed_jobs / total_jobs;

    const metrics = {
      total_jobs,
      completed_jobs,
      active_jobs,
      disputed_jobs,
      verified_volume_usdc,
      completion_rate,
      dispute_rate,
    };

    const portfolio_links = profile?.portfolio_links ? (profile.portfolio_links as any[]).filter(v => typeof v === "string") : [];

    const duration = Date.now() - startTime;
    logger.info("User profile fetched successfully", {
      address,
      total_jobs,
      completed_jobs,
      duration,
    });

    res.status(200).json({
      address,
      display_name: profile?.display_name || null,
      headline: profile?.headline || "",
      bio: profile?.bio || "",
      portfolio_links,
      updated_at: profile?.updated_at || new Date(),
      metrics,
      history,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("GET /users/:address/profile error", {
      address,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/v1/users/:address/profile
router.put("/:address/profile", async (req: Request<{ address: string }>, res: Response) => {
  const startTime = Date.now();
  const { address } = req.params;
  logger.debug("PUT /users/:address/profile request", { address });

  try {
    const data = updateProfileSchema.parse(req.body);

    const portfolio_links = data.portfolio_links
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, 6);

    await prisma.profiles.upsert({
      where: { address },
      update: {
        display_name: data.display_name,
        headline: data.headline,
        bio: data.bio,
        portfolio_links,
      },
      create: {
        address,
        display_name: data.display_name,
        headline: data.headline,
        bio: data.bio,
        portfolio_links,
      },
    });

    const duration = Date.now() - startTime;
    logger.info("User profile updated successfully", {
      address,
      duration,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof z.ZodError) {
      logger.warn("Profile validation failed", {
        address,
        errors: error.issues,
        duration,
      });
      return res.status(400).json({ error: error.issues[0]?.message || "Validation failed" });
    }
    logger.error("PUT /users/:address/profile error", {
      address,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/users/:address/saved-jobs - Get paginated saved jobs for user
router.get("/:address/saved-jobs", async (req: Request<{ address: string }>, res: Response) => {
  const startTime = Date.now();
  const { address } = req.params;

  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const skip = (page - 1) * limit;

    logger.debug("GET /users/:address/saved-jobs request", { address, page, limit });

    const [savedJobs, total] = await Promise.all([
      prisma.saved_jobs.findMany({
        where: { user_address: address },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.saved_jobs.count({ where: { user_address: address } }),
    ]);

    const duration = Date.now() - startTime;
    logger.info("Saved jobs fetched successfully", {
      address,
      count: savedJobs.length,
      total,
      page,
      limit,
      duration,
    });

    res.status(200).json({
      data: savedJobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("GET /users/:address/saved-jobs error", {
      address,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/users/address-mappings - List all user address mappings with pagination and filtering
router.get("/address-mappings/list", async (req: Request, res: Response) => {
  const startTime = Date.now();
  logger.debug("GET /address-mappings request", { query: req.query });

  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const skip = (page - 1) * limit;
    const filterType = (req.query.type as string)?.toLowerCase() || "all";

    logger.info("Fetching address mappings", { page, limit, filterType });

    let addressMappings: any[] = [];
    let total = 0;

    if (filterType === "profiles" || filterType === "all") {
      const profiles = await prisma.profiles.findMany({
        select: { address: true, display_name: true, updated_at: true },
        orderBy: { updated_at: "desc" },
        skip,
        take: limit,
      });
      const profileCount = await prisma.profiles.count();

      addressMappings = profiles.map(p => ({
        address: p.address,
        type: "profile",
        display_name: p.display_name,
        updated_at: p.updated_at,
      }));
      total = profileCount;
    } else if (filterType === "sessions") {
      const sessions = await prisma.sessions.findMany({
        select: { address: true, expires_at: true },
        orderBy: { expires_at: "desc" },
        skip,
        take: limit,
      });
      const sessionCount = await prisma.sessions.count();

      addressMappings = sessions.map(s => ({
        address: s.address,
        type: "session",
        expires_at: s.expires_at,
      }));
      total = sessionCount;
    } else if (filterType === "arbiters") {
      const arbiters = await prisma.arbiters.findMany({
        select: { address: true, active: true, created_at: true },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      });
      const arbiterCount = await prisma.arbiters.count();

      addressMappings = arbiters.map(a => ({
        address: a.address,
        type: "arbiter",
        active: a.active,
        created_at: a.created_at,
      }));
      total = arbiterCount;
    }

    const duration = Date.now() - startTime;
    logger.info("Address mappings fetched successfully", {
      count: addressMappings.length,
      total,
      filterType,
      duration,
    });

    res.status(200).json({
      data: addressMappings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      filter: filterType,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("GET /address-mappings error", {
      error: error instanceof Error ? error.message : String(error),
      duration,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/users/:address/activity - Get paginated activity log for user address
router.get("/:address/activity", async (req: Request<{ address: string }>, res: Response) => {
  const startTime = Date.now();
  const { address } = req.params;

  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const skip = (page - 1) * limit;

    logger.debug("GET /users/:address/activity request", { address, page, limit });

    const [activities, total] = await Promise.all([
      prisma.activity_logs.findMany({
        where: { user_address: address },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.activity_logs.count({ where: { user_address: address } }),
    ]);

    const duration = Date.now() - startTime;
    logger.info("User activity fetched successfully", {
      address,
      count: activities.length,
      total,
      page,
      limit,
      duration,
    });

    res.status(200).json({
      data: activities,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("GET /users/:address/activity error", {
      address,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/users/:address/jobs - Get paginated jobs for user (as client or freelancer)
router.get("/:address/jobs", async (req: Request<{ address: string }>, res: Response) => {
  const startTime = Date.now();
  const { address } = req.params;

  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const skip = (page - 1) * limit;
    const status = (req.query.status as string)?.toLowerCase() || "all";

    logger.debug("GET /users/:address/jobs request", { address, page, limit, status });

    const whereCondition = status === "all"
      ? {
          OR: [{ client_address: address }, { freelancer_address: address }],
        }
      : {
          status,
          OR: [{ client_address: address }, { freelancer_address: address }],
        };

    const [jobs, total] = await Promise.all([
      prisma.jobs.findMany({
        where: whereCondition,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.jobs.count({ where: whereCondition }),
    ]);

    const duration = Date.now() - startTime;
    logger.info("User jobs fetched successfully", {
      address,
      count: jobs.length,
      total,
      page,
      limit,
      status,
      duration,
    });

    res.status(200).json({
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      filter: { status },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("GET /users/:address/jobs error", {
      address,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;