"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ExternalLink,
  PencilLine,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { Stars } from "@/components/stars";
import { api, type PublicProfile } from "@/lib/api";
import {
  formatDate,
  formatPercent,
  formatUsdc,
  shortenAddress,
} from "@/lib/format";
import {
  getReputationView,
  type ReputationMetrics,
} from "@/lib/reputation";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

type TabId = "overview" | "history" | "reliability";

export default function PublicProfilePage() {
  const { address } = useParams<{ address: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [freelancerRep, setFreelancerRep] = useState<ReputationMetrics | null>(null);
  const [clientRep, setClientRep] = useState<ReputationMetrics | null>(null);
  const [viewerAddress, setViewerAddress] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [portfolioLinks, setPortfolioLinks] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getConnectedWalletAddress().then(setViewerAddress);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const [profileData, reputationView] = await Promise.all([
          api.users.getProfile(address),
          getReputationView(address),
        ]);

        if (!active) return;
        setProfile(profileData);
        setFreelancerRep(reputationView.freelancer);
        setClientRep(reputationView.client);
        setDisplayName(profileData.display_name ?? "");
        setHeadline(profileData.headline);
        setBio(profileData.bio);
        setPortfolioLinks(profileData.portfolio_links.join("\n"));
        setError(null);
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load this profile.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [address]);

  const isOwner = viewerAddress === address;

  async function handleConnectWallet() {
    const connected = await connectWallet();
    setViewerAddress(connected);
  }

  async function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!isOwner) return;
    setSaving(true);

    try {
      const updated = await api.users.updateProfile(address, address, {
        display_name: displayName || undefined,
        headline,
        bio,
        portfolio_links: portfolioLinks
          .split("\n")
          .map((link) => link.trim())
          .filter(Boolean),
      });
      setProfile(updated);
      setEditing(false);
    } catch {
      alert("Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SiteShell
        eyebrow="Public Profile"
        title="Loading profile"
        description="Collecting off-chain identity data and Soroban reputation metrics."
      >
        <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white/70" />
      </SiteShell>
    );
  }

  if (!profile) {
    return (
      <SiteShell
        eyebrow="Public Profile"
        title="Profile unavailable"
        description={error ?? "We couldn't load this address."}
      >
        <div className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-700">
          {error ?? "Profile unavailable."}
        </div>
      </SiteShell>
    );
  }

  const tabs: TabId[] = ["overview", "history", "reliability"];

  return (
    <SiteShell
      eyebrow="Public Profile"
      title={profile.display_name || shortenAddress(profile.address, 10, 6)}
      description="A hybrid identity page that mixes editable profile context with immutable Soroban reputation math."
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.5)] sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                  <ShieldCheck className="h-4 w-4" />
                  Immutable reputation + editable brand layer
                </div>
                <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">
                  {profile.display_name || shortenAddress(profile.address, 10, 6)}
                </h1>
                <p className="mt-3 text-lg text-slate-600">
                  {profile.headline || "Independent specialist building with verifiable delivery signals."}
                </p>
                <p className="mt-5 text-sm leading-7 text-slate-600">
                  {profile.bio || "No public bio has been added yet."}
                </p>
              </div>

              <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 p-5 text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Wallet address
                </p>
                <p className="mt-3 text-sm font-medium text-slate-800">
                  {shortenAddress(profile.address, 12, 6)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Updated {formatDate(profile.updated_at)}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Freelancer score
                </p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <Stars value={freelancerRep?.starRating ?? 2.5} />
                  <span className="text-sm font-semibold text-slate-900">
                    {freelancerRep?.averageStars.toFixed(1) ?? "2.5"}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {freelancerRep?.scoreBps ?? 5000} bps on-chain
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Completed jobs
                </p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">
                  {profile.metrics.completed_jobs}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {formatUsdc(profile.metrics.verified_volume_usdc)} verified volume
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Dispute rate
                </p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">
                  {formatPercent(profile.metrics.dispute_rate)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Historical resolution pressure
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                    activeTab === tab
                      ? "bg-slate-950 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-slate-950"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </section>

          {activeTab === "overview" ? (
            <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
              <h2 className="text-xl font-semibold text-slate-950">
                Portfolio links
              </h2>
              <div className="mt-5 space-y-3">
                {profile.portfolio_links.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    No public links have been added yet.
                  </div>
                ) : (
                  profile.portfolio_links.map((link) => (
                    <a
                      key={link}
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:text-slate-950"
                    >
                      <span className="truncate">{link}</span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {activeTab === "history" ? (
            <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
              <h2 className="text-xl font-semibold text-slate-950">
                Chronological execution ledger
              </h2>
              <div className="mt-5 space-y-4">
                {profile.history.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    No completed contracts have been recorded yet.
                  </div>
                ) : (
                  profile.history.map((entry) => (
                    <article
                      key={entry.job_id}
                      className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            {entry.role}
                          </p>
                          <h3 className="mt-2 text-lg font-semibold text-slate-950">
                            {entry.title}
                          </h3>
                          <p className="mt-2 text-sm text-slate-600">
                            Counterparty: {shortenAddress(entry.counterparty)}
                          </p>
                        </div>
                        <div className="text-right text-sm text-slate-500">
                          <p className="font-semibold text-slate-900">
                            {formatUsdc(entry.budget_usdc)}
                          </p>
                          <p className="mt-2">{formatDate(entry.completed_at)}</p>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {activeTab === "reliability" ? (
            <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
              <h2 className="text-xl font-semibold text-slate-950">
                Reliability breakdown
              </h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Completion rate
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950">
                    {formatPercent(profile.metrics.completion_rate)}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Client score
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950">
                    {clientRep?.scoreBps ?? 5000} bps
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Active jobs
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950">
                    {profile.metrics.active_jobs}
                  </p>
                </div>
                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Reviews counted
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950">
                    {freelancerRep?.reviews ?? 0}
                  </p>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <section className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_20px_60px_-48px_rgba(15,23,42,0.8)]">
            <div className="flex items-center gap-3">
              <Wallet className="h-5 w-5 text-amber-300" />
              <h2 className="text-lg font-semibold">Owner controls</h2>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Only the wallet owner can unlock the edit form that updates bio and portfolio links.
            </p>
            {isOwner ? (
              <button
                type="button"
                onClick={() => setEditing((value) => !value)}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
              >
                <PencilLine className="h-4 w-4" />
                {editing ? "Close editor" : "Edit profile"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnectWallet}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
              >
                <Wallet className="h-4 w-4" />
                Connect wallet
              </button>
            )}
          </section>

          {editing && isOwner ? (
            <form
              onSubmit={handleSaveProfile}
              className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]"
            >
              <h2 className="text-lg font-semibold text-slate-950">
                Edit public profile
              </h2>
              <div className="mt-5 space-y-4">
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Display name"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                />
                <input
                  value={headline}
                  onChange={(event) => setHeadline(event.target.value)}
                  placeholder="Headline"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                />
                <textarea
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="Public bio"
                  className="min-h-[140px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                />
                <textarea
                  value={portfolioLinks}
                  onChange={(event) => setPortfolioLinks(event.target.value)}
                  placeholder="One portfolio link per line"
                  className="min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save profile"}
                </button>
              </div>
            </form>
          ) : null}

          <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
            <h2 className="text-lg font-semibold text-slate-950">
              Share externally
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              This page is designed to read cleanly when shared in proposals, tweets, or portfolio decks.
            </p>
            <Link
              href="/jobs"
              className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-amber-700 underline"
            >
              Browse the job board
            </Link>
          </section>
        </aside>
      </div>
    </SiteShell>
  );
}
