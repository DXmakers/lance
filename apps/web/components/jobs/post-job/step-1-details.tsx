"use client";

import * as React from "react";
import { FormField } from "./form-field";
import RichTextEditor from "@/components/ui/rich-text-editor";
import { cn } from "@/lib/utils";

export interface Step1DetailsProps {
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  tagsInput: string;
  setTagsInput: (value: string) => void;
  skillsInput: string;
  setSkillsInput: (value: string) => void;
  titleError?: string | null;
  descriptionError?: string | null;
  tagsError?: string | null;
  skillsError?: string | null;
  disabled?: boolean;
}

export function Step1Details({
  title,
  setTitle,
  description,
  setDescription,
  tagsInput,
  setTagsInput,
  skillsInput,
  setSkillsInput,
  titleError,
  descriptionError,
  tagsError,
  skillsError,
  disabled = false,
}: Step1DetailsProps) {
  return (
    <section className="space-y-6" aria-labelledby="job-details-heading">
      <h2 id="job-details-heading" className="sr-only">
        Job Details
      </h2>

      <FormField
        id="job-title"
        label="Job Title"
        error={titleError}
        required
        hint="Be specific: e.g., 'Build a Soroban Smart Contract with Escrow'"
      >
        <input
          type="text"
          id="job-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={cn(
            "flex h-11 w-full rounded-xl border bg-zinc-950/50 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 outline-none transition-all duration-150",
            "focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            titleError
              ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400/20"
              : "border-zinc-800",
          )}
          placeholder="e.g., Build a Soroban Smart Contract"
          disabled={disabled}
          aria-required="true"
          aria-invalid={!!titleError}
          autoComplete="off"
        />
      </FormField>

      <FormField
        id="job-description"
        label="Scope Description"
        error={descriptionError}
        required
        hint="Provide detailed requirements, deliverables, and acceptance criteria"
      >
        <RichTextEditor
          id="job-description"
          value={description}
          onChange={setDescription}
          placeholder="Describe the job scope, requirements, and expected deliverables in detail..."
          disabled={disabled}
          className="min-h-[200px]"
        />
      </FormField>

      <div className="grid gap-6 sm:grid-cols-2">
        <FormField
          id="job-tags"
          label="Tags"
          error={tagsError}
          required
          hint="Comma-separated keywords to help freelancers discover your job"
        >
          <input
            type="text"
            id="job-tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            className={cn(
              "flex h-11 w-full rounded-xl border bg-zinc-950/50 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 outline-none transition-all duration-150",
              "focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
              tagsError
                ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400/20"
                : "border-zinc-800",
            )}
            placeholder="e.g. soroban, smart-contracts, defi"
            disabled={disabled}
            aria-required="true"
            aria-invalid={!!tagsError}
            autoComplete="off"
          />
        </FormField>

        <FormField
          id="job-skills"
          label="Required Skills"
          error={skillsError}
          required
          hint="List the technical skills expected from the freelancer"
        >
          <input
            type="text"
            id="job-skills"
            value={skillsInput}
            onChange={(e) => setSkillsInput(e.target.value)}
            className={cn(
              "flex h-11 w-full rounded-xl border bg-zinc-950/50 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 outline-none transition-all duration-150",
              "focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
              skillsError
                ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400/20"
                : "border-zinc-800",
            )}
            placeholder="e.g. Rust, TypeScript, Smart Contracts"
            disabled={disabled}
            aria-required="true"
            aria-invalid={!!skillsError}
            autoComplete="off"
          />
        </FormField>
      </div>
    </section>
  );
}

