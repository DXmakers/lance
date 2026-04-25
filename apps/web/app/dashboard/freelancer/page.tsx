"use client";

/**
 * Freelancer Dashboard - Main dashboard page
 * 
 * A professional Web3 freelancer interface with:
 * - Glassmorphic design
 * - Strict 8px/4px spacing grid
 * - Zinc-950 background with subtle glow
 * - Emerald/Amber status colors
 * - Responsive grid layout
 */

import { useState } from "react";
import { SidebarNavigation } from "@/components/dashboard/sidebar-navigation";
import { EarningsOverviewCard } from "@/components/dashboard/earnings-overview-card";
import { ProjectCard } from "@/components/dashboard/project-card";
import { ReputationWidget } from "@/components/dashboard/reputation-widget";
import { Plus, Filter, Search } from "lucide-react";

// Mock data - replace with real data from API
const mockEarningsData = {
  totalEarnings: 45250.75,
  pendingPayouts: 3500.00,
  recentIncome: [2100, 2800, 2400, 3200, 2900, 3500, 4100, 3800, 4500, 4200, 3900, 3500],
  currency: "USDC",
};

const mockProjects = [
  {
    id: "1",
    name: "DeFi Dashboard Development",
    clientAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    status: "active" as const,
    milestonesCompleted: 3,
    totalMilestones: 5,
    budget: 8500,
    deadline: "2026-05-15",
    currency: "USDC",
  },
  {
    id: "2",
    name: "Smart Contract Audit",
    clientAddress: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
    status: "pending" as const,
    milestonesCompleted: 1,
    totalMilestones: 3,
    budget: 5000,
    deadline: "2026-05-30",
    currency: "USDC",
  },
  {
    id: "3",
    name: "NFT Marketplace Frontend",
    clientAddress: "GZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    status: "success" as const,
    milestonesCompleted: 4,
    totalMilestones: 4,
    budget: 12000,
    deadline: "2026-04-20",
    currency: "USDC",
  },
  {
    id: "4",
    name: "Token Swap Integration",
    clientAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    status: "active" as const,
    milestonesCompleted: 2,
    totalMilestones: 6,
    budget: 7500,
    deadline: "2026-06-10",
    currency: "USDC",
  },
  {
    id: "5",
    name: "Wallet Connect Implementation",
    clientAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    status: "pending" as const,
    milestonesCompleted: 0,
    totalMilestones: 2,
    budget: 3000,
    deadline: "2026-05-25",
    currency: "USDC",
  },
];

const mockReputationData = {
  rating: 4.8,
  totalReviews: 47,
  completedProjects: 52,
  successRate: 98,
  skills: ["Solidity", "React", "TypeScript", "Web3.js", "Smart Contracts", "DeFi"],
  badges: ["Top Rated", "Fast Delivery", "Expert Verified"],
};

export default function FreelancerDashboard() {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [searchQuery, setSearchQuery] = useState("");

  const handleViewProject = (projectId: string) => {
    console.log("View project:", projectId);
    // Navigate to project details
  };

  const filteredProjects = mockProjects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="dashboard-bg-glow min-h-screen flex">
      {/* Sidebar */}
      <SidebarNavigation
        activeItem={activeNav}
        onNavigate={setActiveNav}
      />

      {/* Main Content */}
      <main className="flex-1 p-6 lg:p-8 custom-scrollbar overflow-y-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-zinc-100 mb-2">
            Welcome back, Freelancer
          </h1>
          <p className="text-zinc-400">
            Here's what's happening with your projects today.
          </p>
        </div>

        {/* Top Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Earnings Overview - Spans 2 columns on large screens */}
          <div className="lg:col-span-2">
            <EarningsOverviewCard data={mockEarningsData} />
          </div>

          {/* Quick Stats */}
          <div className="glass-card animate-fade-in">
            <h3 className="text-zinc-400 text-sm font-medium mb-4">Quick Stats</h3>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-zinc-500 text-xs">Active Projects</span>
                  <span className="text-financial text-2xl text-emerald-400">
                    {mockProjects.filter(p => p.status === "active").length}
                  </span>
                </div>
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-zinc-500 text-xs">Pending</span>
                  <span className="text-financial text-2xl text-amber-400">
                    {mockProjects.filter(p => p.status === "pending").length}
                  </span>
                </div>
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-zinc-500 text-xs">Completed</span>
                  <span className="text-financial text-2xl text-zinc-300">
                    {mockProjects.filter(p => p.status === "success").length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Projects Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-zinc-100">
              Active Projects
            </h2>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-zinc-900/60 border border-zinc-800 rounded-lg text-zinc-100 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>

              {/* Filter Button */}
              <button className="btn-secondary">
                <Filter className="h-4 w-4" />
                Filter
              </button>

              {/* New Project Button */}
              <button className="btn-primary">
                <Plus className="h-4 w-4" />
                New Project
              </button>
            </div>
          </div>

          {/* Projects Grid */}
          <div className="dashboard-grid">
            {filteredProjects.map((project, index) => (
              <ProjectCard
                key={project.id}
                project={project}
                onViewDetails={handleViewProject}
                style={{ animationDelay: `${index * 50}ms` }}
              />
            ))}
          </div>

          {filteredProjects.length === 0 && (
            <div className="glass-card text-center py-12">
              <p className="text-zinc-400">No projects found matching your search.</p>
            </div>
          )}
        </div>

        {/* Reputation Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ReputationWidget data={mockReputationData} />
          </div>

          {/* Recent Activity */}
          <div className="glass-card animate-fade-in">
            <h3 className="text-zinc-100 font-semibold text-lg mb-4">
              Recent Activity
            </h3>
            <div className="space-y-3">
              {[
                { action: "Milestone completed", project: "DeFi Dashboard", time: "2 hours ago" },
                { action: "Payment received", project: "NFT Marketplace", time: "5 hours ago" },
                { action: "New message", project: "Smart Contract Audit", time: "1 day ago" },
                { action: "Review received", project: "Token Swap", time: "2 days ago" },
              ].map((activity, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 pb-3 border-b border-zinc-800 last:border-0 last:pb-0"
                >
                  <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-300 text-sm">{activity.action}</p>
                    <p className="text-zinc-500 text-xs truncate">{activity.project}</p>
                  </div>
                  <span className="text-zinc-500 text-xs flex-shrink-0">
                    {activity.time}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
