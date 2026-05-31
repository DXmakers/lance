"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowUpRight,
  BriefcaseBusiness,
  Clock3,
  ExternalLink,
  PencilLine,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ProfileErrorBoundary } from "@/components/profile/profile-error-boundary";
import { SiteShell } from "@/components/site-shell";
import { Stars } from "@/components/stars";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, type UpdateProfileBody } from "@/lib/api";
import {
  createProfileFormValues,
  getLedgerStatusTone,
  type ProfileFormErrors,
  type ProfileFormValues,
  type ProfileTabId,
  validateProfileForm,
} from "@/lib/profile";
import {
  formatDate,
  formatPercent,
  formatUsdc,
  shortenAddress,
} from "@/lib/format";
import { getReputationView } from "@/lib/reputation";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

const TABS: Array<{ id: ProfileTabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "History" },
  { id: "reliability", label: "Reliability" },
];

const EMPTY_FORM: ProfileFormValues = {
  displayName: "",
  headline: "",
  bio: "",
  portfolioLinks: "",
};

export default function PublicProfilePage() {
  const { address } = useParams<{ address: string }>();

  return (
    <ProfileErrorBoundary>
      <PublicProfileWorkspace address={address} />
    </ProfileErrorBoundary>
  );
}

function PublicProfileWorkspace({ address }: { address: string }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ProfileTabId>("overview");
  const [editing, setEditing] = useState(false);
  const [formErrors, setFormErrors] = useState<ProfileFormErrors>({});

  const viewerQuery = useQuery({
    queryKey: ["wallet", "viewer-address"],
    queryFn: getConnectedWalletAddress,
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["profile", address],
    queryFn: () => api.users.getProfile(address),
    enabled: Boolean(address),
    staleTime: 60_000,
  });

  const reputationQuery = useQuery({
    queryKey: ["profile", address, "reputation"],
    queryFn: () => getReputationView(address),
    enabled: Boolean(address),
    staleTime: 300_000,
  });

  const [formValues, setFormValues] = useState<ProfileFormValues>(() =>
    profileQuery.data ? createProfileFormValues(profileQuery.data) : EMPTY_FORM
  );

  const connectWalletMutation = useMutation({
    mutationFn: connectWallet,
    onSuccess: (connectedAddress) => {
      queryClient.setQueryData(["wallet", "viewer-address"], connectedAddress);
      toast.success("Wallet connected");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Wallet connection failed.");
    },
  });

  const saveProfileMutation = useMutation({
    mutationFn: (payload: UpdateProfileBody) =>
      api.users.updateProfile(address, payload),
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData(["profile", address], updatedProfile);
      setFormValues(createProfileFormValues(updatedProfile));
      setFormErrors({});
      setEditing(false);
      toast.success("Profile updated successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save profile.");
    },
  });

  const isOwner = viewerQuery.data === address;
  const profile = profileQuery.data;
  const reputation = reputationQuery.data;

  function updateField<K extends keyof ProfileFormValues>(
    key: K,
    value: ProfileFormValues[K],
  ) {
    const nextValues = { ...formValues, [key]: value };
    setFormValues(nextValues);
    setFormErrors(validateProfileForm(nextValues).errors);
  }

  function toggleEditing() {
    if (!profile) return;
    const nextEditing = !editing;
    if (nextEditing) {
      setFormValues(createProfileFormValues(profile));
      setFormErrors({});
    }
    setEditing(nextEditing);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOwner) return;

    const result = validateProfileForm(formValues);
    setFormErrors(result.errors);
    if (!result.data) return;
    saveProfileMutation.mutate(result.data);
  }

  if (profileQuery.isPending) {
    return (
      <SiteShell
        eyebrow="Profile"
        title="Loading profile workspace"
        description="Pulling public identity, delivery history, and on-chain reputation into one trusted surface."
      >
        <ProfilePageSkeleton />
      </SiteShell>
    );
  }

  if (!profile || profileQuery.isError) {
    return (
      <SiteShell
        eyebrow="Profile"
        title="Profile unavailable"
        description="We could not assemble this user profile right now."
      >
        <Card className="rounded-[24px] border-rose-500/25 bg-rose-500/10 text-foreground">
          <CardHeader>
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-rose-500" />
              <CardTitle>Unable to load this profile</CardTitle>
            </div>
            <CardDescription className="text-sm leading-6 text-foreground/75">
              {profileQuery.error instanceof Error
                ? profileQuery.error.message
                : "Try again to reconnect the off-chain profile view and reputation snapshot."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void profileQuery.refetch()}>
              Retry profile fetch
            </Button>
            <Button asChild variant="outline">
              <Link href="/jobs">Back to job board</Link>
            </Button>
          </CardContent>
        </Card>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      eyebrow="Profile"
      title={profile.display_name || shortenAddress(profile.address, 10, 6)}
      description="A reputation-aware identity surface for evaluating talent, sharing proof of work, and managing your public Web3 presence."
    >
      <main className="relative overflow-hidden rounded-[32px] bg-zinc-950 text-zinc-50 shadow-[0_36px_120px_-68px_rgba(0,0,0,0.95)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_28%),radial-gradient(circle_at_78%_10%,rgba(16,185,129,0.15),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.05),transparent_35%)]" />
        <div className="relative grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1.35fr)_360px] xl:p-8">
          <section className="space-y-6">
            <Card className="rounded-[24px] border-white/10 bg-white/7 text-zinc-50 shadow-none backdrop-blur-xl">
              <CardHeader className="gap-6 p-6 sm:p-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <Badge
                      variant="outline"
                      className="border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-200"
                    >
                      <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                      Trusted public profile
                    </Badge>
                    <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                      {profile.display_name || shortenAddress(profile.address, 12, 6)}
                    </h1>
                    <p className="mt-3 text-base leading-7 text-zinc-200">
                      {profile.headline ||
                        "Independent specialist building calm, verifiable delivery systems for complex Web3 work."}
                    </p>
                    <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-300">
                      {profile.bio || "This user has not added a public bio yet."}
                    </p>
                  </div>

                  <div className="grid min-w-full gap-3 sm:min-w-[260px]">
                    <ProfileSignal
                      label="Wallet"
                      value={shortenAddress(profile.address, 14, 6)}
                      caption={`Updated ${formatDate(profile.updated_at)}`}
                    />
                    <ProfileSignal
                      label="Completion"
                      value={formatPercent(profile.metrics.completion_rate)}
                      caption={`${profile.metrics.completed_jobs} completed jobs`}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <StatGlassCard
                    label="Freelancer score"
                    value={
                      reputationQuery.isPending
                        ? "..."
                        : reputation?.freelancer.averageStars.toFixed(1) ?? "2.5"
                    }
                    caption={`${reputation?.freelancer.scoreBps ?? 5000} bps on-chain`}
                    accent="emerald"
                  >
                    <Stars value={reputation?.freelancer.starRating ?? 2.5} />
                  </StatGlassCard>
                  <StatGlassCard
                    label="Verified volume"
                    value={formatUsdc(profile.metrics.verified_volume_usdc)}
                    caption={`${profile.metrics.active_jobs} active opportunities`}
                    accent="amber"
                  />
                  <StatGlassCard
                    label="Dispute rate"
                    value={formatPercent(profile.metrics.dispute_rate)}
                    caption="Monitored across client and freelancer history"
                    accent="sky"
                  />
                </div>

                <nav
                  aria-label="Profile sections"
                  className="flex flex-wrap gap-2 rounded-full border border-white/10 bg-white/5 p-2"
                >
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition duration-150 ${
                        activeTab === tab.id
                          ? "bg-white text-zinc-950 shadow-[0_10px_30px_-16px_rgba(255,255,255,0.8)]"
                          : "text-zinc-300 hover:bg-white/8 hover:text-white active:scale-[0.99]"
                      }`}
                      aria-pressed={activeTab === tab.id}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </CardHeader>
            </Card>

            {activeTab === "overview" ? (
              <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                <Card className="rounded-[24px] border-white/10 bg-white/7 text-zinc-50 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-white">Portfolio and proof of work</CardTitle>
                    <CardDescription className="text-zinc-300">
                      Public links give clients a fast way to validate craft, credibility,
                      and specialization.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {profile.portfolio_links.length === 0 ? (
                      <EmptyState
                        title="No portfolio links yet"
                        description="Add project links, case studies, or code samples to strengthen trust at a glance."
                      />
                    ) : (
                      profile.portfolio_links.map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-4 rounded-[20px] border border-white/10 bg-white/5 px-4 py-4 text-sm font-medium text-zinc-100 transition duration-150 hover:border-emerald-400/45 hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 active:scale-[0.995]"
                        >
                          <span className="truncate">{link}</span>
                          <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" />
                        </a>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-[24px] border-white/10 bg-white/7 text-zinc-50 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-white">Commercial trust snapshot</CardTitle>
                    <CardDescription className="text-zinc-300">
                      The signals below help clients evaluate delivery reliability before
                      starting a contract.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <MiniMetric
                      label="Total jobs"
                      value={String(profile.metrics.total_jobs)}
                      tone="text-white"
                    />
                    <MiniMetric
                      label="Disputed jobs"
                      value={String(profile.metrics.disputed_jobs)}
                      tone="text-amber-300"
                    />
                    <MiniMetric
                      label="Client score"
                      value={`${reputation?.client.scoreBps ?? 5000} bps`}
                      tone="text-emerald-300"
                    />
                    <MiniMetric
                      label="Reviews counted"
                      value={String(reputation?.freelancer.reviews ?? 0)}
                      tone="text-sky-300"
                    />
                  </CardContent>
                </Card>
              </section>
            ) : null}

            {activeTab === "history" ? (
              <Card className="rounded-[24px] border-white/10 bg-white/7 text-zinc-50 shadow-none">
                <CardHeader>
                  <CardTitle className="text-white">Delivery history</CardTitle>
                  <CardDescription className="text-zinc-300">
                    Shared job history helps clients and freelancers assess consistency,
                    budget range, and execution cadence.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {profile.history.length === 0 ? (
                    <EmptyState
                      title="No completed jobs recorded"
                      description="Completed jobs will appear here as soon as this profile closes its first contract."
                    />
                  ) : (
                    profile.history.map((entry) => (
                      <article
                        key={entry.job_id}
                        className="rounded-[20px] border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant="outline"
                                className={`border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${getLedgerStatusTone(
                                  entry.status,
                                )}`}
                              >
                                {entry.status.replace(/_/g, " ")}
                              </Badge>
                              <Badge
                                variant="outline"
                                className="border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-zinc-300"
                              >
                                {entry.role}
                              </Badge>
                            </div>
                            <div>
                              <h2 className="text-lg font-semibold text-white">
                                {entry.title}
                              </h2>
                              <p className="mt-2 text-sm leading-6 text-zinc-300">
                                Counterparty {shortenAddress(entry.counterparty, 8, 4)}
                              </p>
                            </div>
                          </div>

                          <dl className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-2 lg:min-w-[280px]">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                                Budget
                              </dt>
                              <dd className="mt-2 font-semibold text-white">
                                {formatUsdc(entry.budget_usdc)}
                              </dd>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                                Completed
                              </dt>
                              <dd className="mt-2 font-semibold text-white">
                                {formatDate(entry.completed_at)}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      </article>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}

            {activeTab === "reliability" ? (
              <section className="grid gap-6 lg:grid-cols-2">
                <Card className="rounded-[24px] border-white/10 bg-white/7 text-zinc-50 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-white">Operational reliability</CardTitle>
                    <CardDescription className="text-zinc-300">
                      This mix of on-chain and off-chain signals shows how consistently the
                      user completes paid work.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ProgressStat
                      label="Completion rate"
                      value={profile.metrics.completion_rate}
                    />
                    <ProgressStat
                      label="Dispute rate"
                      value={1 - profile.metrics.dispute_rate}
                    />
                    <ProgressStat
                      label="Freelancer reputation"
                      value={(reputation?.freelancer.scoreBps ?? 5000) / 10000}
                    />
                  </CardContent>
                </Card>

                <Card className="rounded-[24px] border-white/10 bg-white/7 text-zinc-50 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-white">Live operating posture</CardTitle>
                    <CardDescription className="text-zinc-300">
                      A quick summary for deciding whether to start a brief or request a bid.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <SignalRow
                      icon={<BriefcaseBusiness className="h-4 w-4 text-amber-300" />}
                      label="Open commitments"
                      value={`${profile.metrics.active_jobs} active jobs`}
                    />
                    <SignalRow
                      icon={<Clock3 className="h-4 w-4 text-sky-300" />}
                      label="Review density"
                      value={`${reputation?.freelancer.reviews ?? 0} reviews contributing to score`}
                    />
                    <SignalRow
                      icon={<Sparkles className="h-4 w-4 text-emerald-300" />}
                      label="Best fit"
                      value="Clients who want a high-signal profile with verifiable follow-through"
                    />
                  </CardContent>
                </Card>
              </section>
            ) : null}
          </section>

          <aside className="space-y-6">
            <Card className="rounded-[24px] border-white/10 bg-white/8 text-zinc-50 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-white">
                  <Wallet className="h-5 w-5 text-amber-300" />
                  Profile controls
                </CardTitle>
                <CardDescription className="text-zinc-300">
                  Wallet-gated editing keeps the public narrative controlled by the actual
                  profile owner.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-[20px] border border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-300">
                  Only the connected owner can update profile copy and portfolio links.
                </div>

                {isOwner ? (
                  <Button
                    type="button"
                    onClick={toggleEditing}
                    className="h-11 w-full rounded-full bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.99]"
                  >
                    <PencilLine className="mr-2 h-4 w-4" />
                    {editing ? "Close editor" : "Edit public profile"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => connectWalletMutation.mutate()}
                    disabled={connectWalletMutation.isPending}
                    className="h-11 w-full rounded-full bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.99]"
                  >
                    <Wallet className="mr-2 h-4 w-4" />
                    {connectWalletMutation.isPending ? "Connecting..." : "Connect wallet"}
                  </Button>
                )}
              </CardContent>
            </Card>

            {editing && isOwner ? (
              <Card className="rounded-[24px] border-white/10 bg-white/8 text-zinc-50 shadow-none">
                <CardHeader>
                  <CardTitle className="text-white">Edit public profile</CardTitle>
                  <CardDescription className="text-zinc-300">
                    Changes validate in real time and publish back into the cached profile
                    surface instantly after save.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                    <ProfileField
                      label="Display name"
                      hint="Optional. Keep it concise and recognizable."
                      error={formErrors.displayName}
                      fieldId="profile-display-name"
                    >
                      <Input
                        id="profile-display-name"
                        value={formValues.displayName}
                        onChange={(event) => updateField("displayName", event.target.value)}
                        placeholder="Amina O."
                        className="rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-zinc-500"
                        aria-invalid={Boolean(formErrors.displayName)}
                      />
                    </ProfileField>

                    <ProfileField
                      label="Headline"
                      hint="Summarize your strongest value in one sentence."
                      error={formErrors.headline}
                      fieldId="profile-headline"
                    >
                      <Input
                        id="profile-headline"
                        value={formValues.headline}
                        onChange={(event) => updateField("headline", event.target.value)}
                        placeholder="Senior Web3 strategist for escrow and talent systems"
                        className="rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-zinc-500"
                        aria-invalid={Boolean(formErrors.headline)}
                      />
                    </ProfileField>

                    <ProfileField
                      label="Bio"
                      hint="Explain your craft, domain expertise, and working style."
                      error={formErrors.bio}
                      fieldId="profile-bio"
                    >
                      <Textarea
                        id="profile-bio"
                        value={formValues.bio}
                        onChange={(event) => updateField("bio", event.target.value)}
                        placeholder="I design and ship trust-centered freelance experiences with measurable delivery signals."
                        className="min-h-[156px] rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-zinc-500"
                        aria-invalid={Boolean(formErrors.bio)}
                      />
                    </ProfileField>

                    <ProfileField
                      label="Portfolio links"
                      hint="One valid URL per line. Up to 6 links."
                      error={formErrors.portfolioLinks}
                      fieldId="profile-portfolio-links"
                    >
                      <Textarea
                        id="profile-portfolio-links"
                        value={formValues.portfolioLinks}
                        onChange={(event) => updateField("portfolioLinks", event.target.value)}
                        placeholder={"https://amina.dev\nhttps://github.com/amina"}
                        className="min-h-[132px] rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-zinc-500"
                        aria-invalid={Boolean(formErrors.portfolioLinks)}
                      />
                    </ProfileField>

                    <Button
                      type="submit"
                      disabled={saveProfileMutation.isPending}
                      className="h-11 w-full rounded-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400 active:scale-[0.99]"
                    >
                      {saveProfileMutation.isPending ? "Saving profile..." : "Save profile"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            <Card className="rounded-[24px] border-white/10 bg-white/8 text-zinc-50 shadow-none">
              <CardHeader>
                <CardTitle className="text-white">Share profile</CardTitle>
                <CardDescription className="text-zinc-300">
                  Designed to read well in proposals, social shares, and client reviews.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button asChild variant="outline" className="h-11 w-full rounded-full border-white/10 bg-white/5 text-white hover:bg-white/10">
                  <Link href="/jobs">
                    Browse live opportunities
                    <ArrowUpRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </SiteShell>
  );
}

function ProfileSignal({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/6 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{caption}</p>
    </div>
  );
}

function StatGlassCard({
  label,
  value,
  caption,
  accent,
  children,
}: {
  label: string;
  value: string;
  caption: string;
  accent: "emerald" | "amber" | "sky";
  children?: ReactNode;
}) {
  const accentClass =
    accent === "emerald"
      ? "from-emerald-500/20"
      : accent === "amber"
        ? "from-amber-500/20"
        : "from-sky-500/20";

  return (
    <div
      className={`rounded-[20px] border border-white/10 bg-gradient-to-br ${accentClass} to-white/5 p-4`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
        {label}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-2xl font-semibold text-white">{value}</p>
        {children}
      </div>
      <p className="mt-2 text-xs text-zinc-400">{caption}</p>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function SignalRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[20px] border border-white/10 bg-black/20 p-4">
      <div className="mt-0.5 rounded-full border border-white/10 bg-white/5 p-2">{icon}</div>
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-1 text-sm leading-6 text-zinc-300">{value}</p>
      </div>
    </div>
  );
}

function ProgressStat({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(1, value));
  const width = `${Math.round(safeValue * 100)}%`;

  return (
    <div className="space-y-3 rounded-[20px] border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{label}</p>
        <span className="text-sm font-semibold text-emerald-300">{width}</span>
      </div>
      <div className="h-2 rounded-full bg-white/10">
        <div
          className="h-2 rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
          style={{ width }}
        />
      </div>
    </div>
  );
}

function ProfileField({
  label,
  hint,
  error,
  fieldId,
  children,
}: {
  label: string;
  hint: string;
  error?: string;
  fieldId: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2" htmlFor={fieldId}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className="text-[11px] text-zinc-500">{hint}</span>
      </div>
      {children}
      <p className={`text-xs ${error ? "text-amber-300" : "text-zinc-500"}`}>
        {error ?? "Looks good."}
      </p>
    </label>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[20px] border border-dashed border-white/15 bg-black/20 px-4 py-10 text-center">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
        {description}
      </p>
    </div>
  );
}

function ProfilePageSkeleton() {
  return (
    <div className="overflow-hidden rounded-[32px] bg-zinc-950 p-4 shadow-[0_36px_120px_-68px_rgba(0,0,0,0.95)] sm:p-6 xl:p-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-[24px] border border-white/10 bg-white/6 p-6 sm:p-8">
            <div className="space-y-4">
              <Skeleton className="h-7 w-40 rounded-full" />
              <Skeleton className="h-11 w-[62%]" />
              <Skeleton className="h-4 w-[78%]" />
              <Skeleton className="h-4 w-[88%]" />
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <Skeleton className="h-28 w-full rounded-[20px]" />
              <Skeleton className="h-28 w-full rounded-[20px]" />
              <Skeleton className="h-28 w-full rounded-[20px]" />
            </div>
          </section>
          <section className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-80 w-full rounded-[24px]" />
            <Skeleton className="h-80 w-full rounded-[24px]" />
          </section>
        </div>
        <aside className="space-y-6">
          <Skeleton className="h-64 w-full rounded-[24px]" />
          <Skeleton className="h-72 w-full rounded-[24px]" />
        </aside>
      </div>
    </div>
  );
}
