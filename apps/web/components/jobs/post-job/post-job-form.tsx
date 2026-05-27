"use client";

import * as React from "react";
import { usePostJob } from "@/hooks/use-post-job";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { StepIndicator } from "./step-indicator";
import { Step1Details } from "./step-1-details";
import { Step2Budget } from "./step-2-budget";
import { Step3Review } from "./step-3-review";
import { z } from "zod";

const today = new Date().toISOString().slice(0, 10);

const jobFormSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  description: z.string().min(20, "Scope must be at least 20 characters."),
  budget: z.number().min(100, "Budget must be at least 100 USDC."),
  milestones: z.number().min(1, "At least one milestone is required."),
  tags: z.array(z.string().min(1)).min(1, "Add at least one tag."),
  skills: z.array(z.string().min(1)).min(1, "Add at least one required skill."),
  estimatedCompletionDate: z.string().refine(
    (value) => new Date(value) >= new Date(today),
    { message: "Estimated completion date cannot be in the past." },
  ),
  estimatedDurationDays: z.number().min(1).optional(),
  memo: z.string().max(100).optional(),
});

function parseDelimitedList(value: string): string[] {
  return value
    .split(/[;,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface PostJobFormProps {
  onSuccess?: () => void;
}

export function PostJobForm({ onSuccess }: PostJobFormProps) {
  const [step, setStep] = React.useState(1);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [budget, setBudget] = React.useState(1000);
  const [milestones, setMilestones] = React.useState(1);
  const [memo, setMemo] = React.useState("");
  const [estimatedCompletionDate, setEstimatedCompletionDate] = React.useState(() => {
    const target = new Date();
    target.setDate(target.getDate() + 14);
    return target.toISOString().slice(0, 10);
  });
  const [estimatedDurationDays, setEstimatedDurationDays] = React.useState("14");
  const [tagsInput, setTagsInput] = React.useState("");
  const [skillsInput, setSkillsInput] = React.useState("");
  const [stepError, setStepError] = React.useState<string | null>(null);

  const { submit, isSubmitting } = usePostJob();
  const txStep = useTxStatusStore((state: { step: string }) => state.step);
  const isTxInProgress = !["idle", "confirmed", "failed"].includes(txStep);

  const tags = React.useMemo(() => parseDelimitedList(tagsInput), [tagsInput]);
  const skills = React.useMemo(() => parseDelimitedList(skillsInput), [skillsInput]);

  const reviewItems = React.useMemo(
    () => [
      { label: "Title", value: title || "Untitled job" },
      { label: "Budget", value: `${budget} USDC` },
      { label: "Milestones", value: `${milestones}` },
      {
        label: "Target Completion",
        value: estimatedCompletionDate,
      },
      {
        label: "Duration Target",
        value: estimatedDurationDays ? `${estimatedDurationDays} days` : "Not specified",
      },
      {
        label: "Tags",
        value: tags.length ? tags.join(", ") : "None",
      },
      {
        label: "Skills",
        value: skills.length ? skills.join(", ") : "None",
      },
    ],
    [title, budget, milestones, estimatedCompletionDate, estimatedDurationDays, tags, skills],
  );

  function validateStep(stepToValidate: number): boolean {
    if (stepToValidate === 1) {
      const result = z
        .object({
          title: jobFormSchema.shape.title,
          description: jobFormSchema.shape.description,
          tags: jobFormSchema.shape.tags,
          skills: jobFormSchema.shape.skills,
        })
        .safeParse({
          title,
          description,
          tags,
          skills,
        });

      if (!result.success) {
        setStepError(result.error.issues[0].message);
        return false;
      }
      setStepError(null);
      return true;
    }

    if (stepToValidate === 2) {
      const result = z
        .object({
          budget: jobFormSchema.shape.budget,
          milestones: jobFormSchema.shape.milestones,
          estimatedCompletionDate: jobFormSchema.shape.estimatedCompletionDate,
          estimatedDurationDays: jobFormSchema.shape.estimatedDurationDays,
          memo: jobFormSchema.shape.memo,
        })
        .safeParse({
          budget,
          milestones,
          estimatedCompletionDate,
          estimatedDurationDays: estimatedDurationDays ? Number(estimatedDurationDays) : undefined,
          memo: memo || undefined,
        });

      if (!result.success) {
        setStepError(result.error.issues[0].message);
        return false;
      }
      setStepError(null);
      return true;
    }

    const result = jobFormSchema.safeParse({
      title,
      description,
      budget,
      milestones,
      tags,
      skills,
      estimatedCompletionDate,
      estimatedDurationDays: estimatedDurationDays ? Number(estimatedDurationDays) : undefined,
      memo: memo || undefined,
    });

    if (!result.success) {
      setStepError(result.error.issues[0].message);
      return false;
    }

    setStepError(null);
    return true;
  }

  function handleNext() {
    if (validateStep(step)) {
      setStep((current) => Math.min(3, current + 1));
      setStepError(null);
    }
  }

  function handleBack() {
    setStep((current) => Math.max(1, current - 1));
    setStepError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!validateStep(3)) {
      return;
    }

    try {
      await submit({
        title,
        description,
        budgetUsdc: budget * 10_000_000,
        milestones,
        memo: memo || undefined,
        estimatedCompletionDate,
        tags,
        skillsRequired: skills,
        estimatedDurationDays: estimatedDurationDays ? Number(estimatedDurationDays) : undefined,
      });
      onSuccess?.();
    } catch {
      // Error handling managed by usePostJob + toast system
    }
  }

  const steps = [
    { label: "Scope", description: "Title, description, tags, skills" },
    { label: "Budget", description: "Budget, milestones, timeline" },
    { label: "Review", description: "Confirm and publish" },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <StepIndicator currentStep={step} steps={steps} />

      {stepError && (
        <div
          className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200"
          role="alert"
        >
          {stepError}
        </div>
      )}

      {step === 1 && (
        <Step1Details
          title={title}
          setTitle={setTitle}
          description={description}
          setDescription={setDescription}
          tagsInput={tagsInput}
          setTagsInput={setTagsInput}
          skillsInput={skillsInput}
          setSkillsInput={setSkillsInput}
          titleError={null}
          descriptionError={null}
          tagsError={null}
          skillsError={null}
          disabled={isSubmitting || isTxInProgress}
        />
      )}

      {step === 2 && (
        <Step2Budget
          budget={budget}
          setBudget={setBudget}
          milestones={milestones}
          setMilestones={setMilestones}
          estimatedCompletionDate={estimatedCompletionDate}
          setEstimatedCompletionDate={setEstimatedCompletionDate}
          estimatedDurationDays={estimatedDurationDays}
          setEstimatedDurationDays={setEstimatedDurationDays}
          memo={memo}
          setMemo={setMemo}
          budgetError={null}
          milestonesError={null}
          dateError={null}
          durationError={null}
          disabled={isSubmitting || isTxInProgress}
        />
      )}

      {step === 3 && (
        <Step3Review
          reviewItems={reviewItems}
          isSubmitting={isSubmitting || isTxInProgress}
          txStep={txStep}
        />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 1 || isSubmitting || isTxInProgress}
          className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/50 px-6 text-sm font-semibold text-zinc-200 transition-all duration-150 hover:bg-zinc-800/70 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Go back to previous step"
        >
          Back
        </button>
        {step < 3 ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={isSubmitting || isTxInProgress}
            className="inline-flex h-11 items-center justify-center rounded-full bg-amber-400 px-8 text-sm font-semibold text-zinc-950 transition-all duration-150 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Continue to ${steps[step].label}`}
          >
            Continue
          </button>
        ) : (
          <button
            type="submit"
            disabled={isSubmitting || isTxInProgress}
            className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-500 px-8 text-sm font-semibold text-white transition-all duration-150 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Post job on-chain"
          >
            {isSubmitting || isTxInProgress ? (
              <>
                <svg
                  className="mr-2 h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Processing...
              </>
            ) : (
              "Post Job On-Chain"
            )}
          </button>
        )}
      </div>
    </form>
  );
}

PostJobForm.displayName = "PostJobForm";
