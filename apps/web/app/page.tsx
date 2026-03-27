import Link from "next/link";
import { Rocket, ShieldCheck, Zap, Globe, ArrowRight, Star } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 space-y-24 text-center overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/20 blur-[120px] rounded-full -z-10" />
      
      <div className="max-w-4xl space-y-8 relative">
        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-full text-xs font-black tracking-widest uppercase text-primary animate-bounce">
            <Star size={14} /> NEW: AI JUDGE AGENTS INTEGRATED
        </div>
        
        <h1 className="text-7xl md:text-9xl font-black tracking-tighter leading-none uppercase">
            Work at <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-accent to-primary animate-gradient">Light Speed.</span>
        </h1>
        
        <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto font-medium leading-relaxed">
            The first Stellar-native freelance marketplace where trust is mathematically guaranteed. 
            Powered by Soroban smart contracts and AI-driven dispute resolution.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-8">
            <Link href="/jobs" className="group bg-primary hover:bg-primary/80 text-white px-12 py-6 rounded-2xl text-xl font-black shadow-2xl shadow-primary/40 transition-all flex items-center gap-3">
                EXPLORE GIGS <ArrowRight className="group-hover:translate-x-2 transition-transform" />
            </Link>
            <Link href="/jobs/new" className="bg-white/5 hover:bg-white/10 text-white border border-white/10 px-12 py-6 rounded-2xl text-xl font-black transition-all">
                POST A PROJECT
            </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl">
        <div className="glass p-8 rounded-3xl text-left space-y-4 hover:translate-y--2 transition-transform">
            <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center text-primary">
                <ShieldCheck size={28} />
            </div>
            <h3 className="text-2xl font-black uppercase">On-Chain Escrow</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">Funds are locked in transparent smart contracts. Milestone-based releases ensure zero risk for both parties.</p>
        </div>
        <div className="glass p-8 rounded-3xl text-left space-y-4 hover:translate-y--2 transition-transform">
            <div className="w-12 h-12 bg-accent/20 rounded-xl flex items-center justify-center text-accent">
                <Zap size={28} />
            </div>
            <h3 className="text-2xl font-black uppercase">Instant Payouts</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">No 14-day hold periods. Get paid in USDC instantly as milestones are approved by the client or the AI Judge.</p>
        </div>
        <div className="glass p-8 rounded-3xl text-left space-y-4 hover:translate-y--2 transition-transform">
            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                <Globe size={28} />
            </div>
            <h3 className="text-2xl font-black uppercase">Global Reach</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">The borderless nature of Stellar allows you to work with anyone, anywhere, without expensive conversion fees.</p>
        </div>
      </div>
    </main>
  );
}
