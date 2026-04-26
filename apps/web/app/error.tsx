"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 px-6 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-500">
        Something broke
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        We hit an unexpected error
      </h1>
      <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
        The page failed to render. Try again without losing your current session.
      </p>
      <div>
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition duration-150 hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Retry page
        </button>
      </div>
    </main>
  );
}
