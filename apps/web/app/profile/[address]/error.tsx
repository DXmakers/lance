"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ProfileRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <section className="rounded-[28px] border border-rose-500/25 bg-zinc-950 px-6 py-10 text-zinc-50 shadow-[0_32px_120px_-68px_rgba(0,0,0,0.95)] sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-300">
          Profile route error
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          This profile page hit an unexpected failure.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-300">
          Retry the route to rebuild the profile workspace without reloading the rest
          of the application shell.
        </p>
        <Button
          type="button"
          onClick={reset}
          className="mt-6 rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
        >
          Retry profile page
        </Button>
      </section>
    </main>
  );
}
