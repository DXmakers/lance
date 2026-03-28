"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { api, type Job } from "@/lib/api";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("Loading jobs...");

  useEffect(() => {
    let active = true;

    async function loadJobs() {
      try {
        const nextJobs = await api.jobs.list();
        if (!active) {
          return;
        }

        setJobs(nextJobs);
        setStatus(
          nextJobs.length === 0
            ? "No jobs yet. Create one from the console."
            : `${nextJobs.length} jobs ready for review.`,
        );
      } catch (error) {
        if (!active) {
          return;
        }

        setStatus(
          error instanceof Error ? error.message : "Unable to load jobs.",
        );
      }
    }

    void loadJobs();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 rounded-3xl border border-cyan-400/20 bg-slate-900/80 p-8 shadow-2xl shadow-cyan-950/40">
          <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">
            Lance Marketplace
          </p>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <h1 className="text-4xl font-semibold">Jobs</h1>
              <p className="max-w-2xl text-sm text-slate-300">{status}</p>
            </div>
            <Link
              href="/jobs/new"
              className="inline-flex items-center justify-center rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
            >
              Post a Job
            </Link>
          </div>
        </header>

        <section className="grid gap-4">
          {jobs.map((job) => (
            <article
              key={job.id}
              className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold">{job.title}</h2>
                  <p className="text-sm text-slate-300">{job.description}</p>
                </div>
                <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-emerald-300">
                  {job.status}
                </span>
              </div>
              <dl className="mt-5 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Budget
                  </dt>
                  <dd>${(job.budget_usdc / 1_000_0000).toFixed(2)} USDC</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Milestones
                  </dt>
                  <dd>{job.milestones}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Client
                  </dt>
                  <dd className="break-all">{job.client_address}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
