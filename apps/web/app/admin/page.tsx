"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminVault } from "@/components/blockchain/admin-vault";

const adminLinks = [
    {
        href: "/admin/monitoring",
        title: "Monitoring",
        description: "Live indexer and network status dashboard.",
    },
    {
        href: "/admin/monitoring/deposit-indexing",
        title: "Deposit Indexing",
        description: "Focused view for deposit event processing and state.",
    },
];

export default function AdminDashboardPage() {
    return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.08),_transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] px-4 py-10 text-slate-950 sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
                <section className="grid gap-4 rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_30px_90px_-60px_rgba(15,23,42,0.45)] backdrop-blur sm:p-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
                    <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                            Admin Console
                        </p>
                        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                            Secure Vault Operations
                        </h1>
                        <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                            Manage the admin key vault and jump to the existing monitoring views from a single
                            dashboard entry point.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        {adminLinks.map((link) => (
                            <Link key={link.href} href={link.href} className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white">
                                <p className="text-sm font-semibold text-slate-950">{link.title}</p>
                                <p className="mt-1 text-xs leading-5 text-slate-600 group-hover:text-slate-700">
                                    {link.description}
                                </p>
                            </Link>
                        ))}
                    </div>
                </section>

                <Card className="border-slate-200 bg-white/90 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.35)]">
                    <CardHeader>
                        <CardTitle className="text-2xl tracking-tight">Admin Vault</CardTitle>
                        <CardDescription>
                            Submit the connected admin wallet into the secure vault contract.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <AdminVault />
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}