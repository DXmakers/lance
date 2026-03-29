"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(1000);
  const [milestones, setMilestones] = useState(1);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const job = await api.jobs.create({
        title,
        description,
        budget_usdc: budget * 10_000_000,
        milestones,
        client_address: "GD...CLIENT",
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      alert("Failed to create job");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Post a New Job</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-3 rounded-lg border border-gray-300 dark:bg-zinc-900"
            placeholder="e.g. Build a Soroban Smart Contract"
            required
            id="job-title"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-3 rounded-lg border border-gray-300 dark:bg-zinc-900 min-h-[150px]"
            placeholder="Describe the project requirements..."
            required
            id="job-description"
          />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Budget (USDC)</label>
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="w-full p-3 rounded-lg border border-gray-300 dark:bg-zinc-900"
              required
              id="job-budget"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Milestones</label>
            <input
              type="number"
              value={milestones}
              onChange={(e) => setMilestones(Number(e.target.value))}
              className="w-full p-3 rounded-lg border border-gray-300 dark:bg-zinc-900"
              min="1"
              required
              id="job-milestones"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50"
          id="submit-job"
        >
          {loading ? "Posting..." : "Post Job"}
        </button>
      </form>
    </main>
  );
}
