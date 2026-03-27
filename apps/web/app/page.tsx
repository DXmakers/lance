"use client";

import { useAuthStore } from "@/lib/store/use-auth-store";
import { Button } from "@/components/ui/button";
import { ArrowRight, Briefcase, Zap, ShieldCheck, Globe, Star, CheckCircle2 } from "lucide-react";

export default function Home() {
  const { isLoggedIn, role, login } = useAuthStore();

  if (isLoggedIn) {
    return (
      <div className="space-y-12">
        <header className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Zap className="h-4 w-4" />
            <span>Welcome back, {role === 'client' ? 'Client' : 'Freelancer'}</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            {role === 'client' ? 'Post your next vision.' : 'Find your next mission.'}
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            {role === 'client' 
              ? "Hire the world's best Soroban experts and manage payments through secure smart contracts."
              : "Apply to high-paying jobs and get paid instantly in XLM or USDC once milestones are hit."}
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="group relative overflow-hidden rounded-3xl border bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/20">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Briefcase className="h-6 w-6" />
              </div>
              <h3 className="mb-2 text-xl font-bold">Smart Contract Developer</h3>
              <p className="mb-6 text-sm text-muted-foreground">
                Develop a custom AMM on Soroban with a focus on liquidity provision incentives.
              </p>
              <div className="flex items-center justify-between text-sm font-medium">
                <span className="text-primary">Budget: 5,000 XLM</span>
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  4.9
                </span>
              </div>
            </div>
          ))}
        </div>

        <section className="rounded-3xl bg-primary/5 p-8 border border-primary/10 flex flex-col md:flex-row items-center justify-between gap-8 mt-12 overflow-hidden relative">
          <div className="z-10 flex flex-col items-start gap-4">
            <h2 className="text-2xl font-bold">Deep Performance Analytics</h2>
            <p className="max-w-md text-muted-foreground">
              Track your earnings, feedback, and contract status in real-time with our on-chain indexing service.
            </p>
            <Button className="group">
              View Analytics
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
          <div className="md:w-1/3 aspect-video bg-background/50 rounded-2xl border flex items-center justify-center relative z-10 glass-card">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-indigo-500/10 rounded-2xl" />
              <div className="h-2/3 w-3/4 flex flex-col gap-2">
                 <div className="h-4 w-full bg-muted rounded animate-pulse" />
                 <div className="h-4 w-2/3 bg-muted rounded animate-pulse" />
                 <div className="h-24 w-full bg-primary/20 rounded mt-2" />
              </div>
          </div>
          {/* Subtle decoration */}
          <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-primary/20 rounded-full blur-[80px]" />
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-16 py-12 text-center md:py-24">
      <div className="flex flex-col items-center gap-6 max-w-4xl px-4">
        <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary shadow-sm glass-morphism">
          <Globe className="mr-2 h-4 w-4" />
          The future of decentralized work is here
        </div>
        <h1 className="text-5xl font-black tracking-tighter md:text-7xl lg:text-8xl bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
          Decentralized Freelance <span className="text-primary italic">Intelligence</span>.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground md:text-xl leading-relaxed">
          Lance bridges the gap between top-tier talent and global visionary clients using 
          <span className="text-foreground font-semibold"> Soroban smart contracts </span> 
          for trustless, instant, and borderless settlements.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 mt-4">
          <Button size="lg" className="h-14 px-8 text-md font-bold rounded-2xl shadow-xl shadow-primary/20 group" onClick={() => login("Freelancer", "f@example.com", "freelancer")}>
            Join as a Freelancer
            <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Button>
          <Button size="lg" variant="outline" className="h-14 px-8 text-md font-bold rounded-2xl border-2 hover:bg-neutral-100 dark:hover:bg-neutral-900" onClick={() => login("Client", "c@example.com", "client")}>
            Find the Best Talent
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl px-4">
        {[
          { icon: <Zap className="h-6 w-6" />, title: "Instant Settlement", desc: "No more waiting for weeks. Funds are released the moment milestones are verified on-chain." },
          { icon: <ShieldCheck className="h-6 w-6" />, title: "Dispute Arbitration", desc: "Fair and transparent dispute resolution governed by collective intelligence." },
          { icon: <Globe className="h-6 w-6" />, title: "Global Payments", desc: "Pay and get paid in XLM or stablecoins anywhere in the world with $0.0001 fees." },
        ].map((feature, i) => (
          <div key={i} className="flex flex-col items-center p-8 rounded-[2rem] border bg-card/40 backdrop-blur-sm transition-all hover:bg-card/60 hover:scale-[1.02]">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-6 ring-1 ring-primary/20">
              {feature.icon}
            </div>
            <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
            <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-foreground text-background w-full rounded-[3rem] p-12 md:p-20 relative overflow-hidden group">
         <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_120%,rgba(120,119,198,0.3),rgba(255,255,255,0))]" />
         <div className="flex flex-col md:flex-row items-center justify-between gap-12 relative z-10">
            <div className="text-left max-w-lg">
                <h2 className="text-3xl md:text-5xl font-bold mb-6 italic tracking-tight">Ready to lanch?</h2>
                <div className="space-y-4">
                    <div className="flex items-start gap-3">
                        <CheckCircle2 className="h-6 w-6 text-primary shrink-0" />
                        <p>Access high-quality job listings automatically curated by AI.</p>
                    </div>
                    <div className="flex items-start gap-3">
                        <CheckCircle2 className="h-6 w-6 text-primary shrink-0" />
                        <p>Build a verifiable on-chain reputation that travels with you.</p>
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-4">
                <Button variant="outline" size="lg" className="h-14 px-10 text-lg rounded-2xl border-primary/50 hover:bg-primary/10 hover:text-primary transition-all">
                    View FAQ
                </Button>
                <Button size="lg" className="h-16 px-12 text-xl font-black rounded-2xl bg-white text-black hover:bg-white/90 shadow-2xl">
                    Get Started Free
                </Button>
            </div>
         </div>
      </div>
    </div>
  );
}
