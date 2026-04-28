"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { LoaderCircle, Plus, X, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePostJob } from "@/hooks/use-post-job";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import RichTextEditor from "@/components/ui/rich-text-editor";
import { TransactionTracker } from "@/components/transaction/transaction-tracker";
import { postJobSchema, type PostJobFormData } from "@/lib/validations/post-job-schema";

export interface PostJobFormProps {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface FormErrors {
  title?: string;
  description?: string;
  skills?: string;
  budgetUsdc?: string;
  deadline?: string;
  paymentType?: string;
  milestones?: string;
}

export function PostJobForm({ onSuccess, onError }: PostJobFormProps) {
  const formId = useId();
  const { submit, isSubmitting } = usePostJob();
  const txStep = useTxStatusStore((state: { step: string }) => state.step);
  const isTxInProgress = !["idle", "confirmed", "failed"].includes(txStep);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [budgetUsdc, setBudgetUsdc] = useState(1000);
  const [deadline, setDeadline] = useState(() => {
    const target = new Date();
    target.setDate(target.getDate() + 14);
    return target.toISOString().slice(0, 10);
  });
  const [paymentType, setPaymentType] = useState<"fixed" | "milestone">("milestone");
  const [milestones, setMilestones] = useState(1);

  const validation = useMemo(() => {
    const data: PostJobFormData = {
      title,
      description,
      skills,
      budgetUsdc,
      deadline,
      paymentType,
      milestones,
    };
    return postJobSchema.safeParse(data);
  }, [title, description, skills, budgetUsdc, deadline, paymentType, milestones]);

  const errors = useMemo((): FormErrors => {
    if (validation.success) return {};
    const fieldErrors: Record<string, string> = {};
    validation.error.issues.forEach((err) => {
      const field = (err.path[0] ?? "") as string;
      if (!fieldErrors[field]) {
        fieldErrors[field] = err.message;
      }
    });
    return fieldErrors as FormErrors;
  }, [validation]);

  const isValid = validation.success && !isSubmitting && !isTxInProgress;
  const canSubmit = isValid && skills.length > 0;

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!validation.success) return;

      try {
        await submit({
          title,
          description,
          budgetUsdc: budgetUsdc * 10_000_000,
          milestones,
          estimatedCompletionDate: deadline,
        });
        onSuccess?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    [validation, title, description, budgetUsdc, milestones, deadline, submit, onSuccess, onError],
  );

  const handleAddSkill = useCallback(() => {
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed) && skills.length < 10) {
      setSkills((prev) => [...prev, trimmed]);
      setSkillInput("");
    }
  }, [skillInput, skills]);

  const handleRemoveSkill = useCallback((skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddSkill();
      }
    },
    [handleAddSkill],
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.5)] sm:p-8"
      data-testid="post-job-form"
    >
      <div className="grid gap-6">
        {/* Job Title */}
        <div>
          <label
            htmlFor={`${formId}-title`}
            className="mb-2 block text-sm font-semibold text-slate-700"
          >
            Job Title
          </label>
          <input
            type="text"
            id={`${formId}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={cn(
              "w-full rounded-2xl border bg-slate-50 px-4 py-3 text-slate-950 outline-none transition",
              errors.title
                ? "border-rose-500 focus:border-rose-400"
                : "border-slate-200 focus:border-amber-400",
            )}
            placeholder="Build a Soroban Smart Contract"
            required
            aria-invalid={errors.title ? "true" : "false"}
            aria-describedby={errors.title ? `${formId}-title-error` : undefined}
            disabled={isSubmitting || isTxInProgress}
            data-testid="job-title-input"
          />
          {errors.title && (
            <p
              id={`${formId}-title-error`}
              className="mt-1.5 text-xs text-rose-500"
              role="alert"
            >
              {errors.title}
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor={`${formId}-description`}
            className="mb-2 block text-sm font-semibold text-slate-700"
          >
            Scope
          </label>
          <RichTextEditor
            id={`${formId}-description`}
            value={description}
            onChange={setDescription}
            minLength={50}
            maxLength={5000}
            error={errors.description}
            ariaLabel="Job description"
            testId="job-description"
          />
        </div>

        {/* Skills */}
        <div>
          <label
            htmlFor={`${formId}-skills-input`}
            className="mb-2 block text-sm font-semibold text-slate-700"
          >
            Required Skills
          </label>
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
                data-testid={`skill-tag-${skill.toLowerCase()}`}
              >
                {skill}
                <button
                  type="button"
                  onClick={() => handleRemoveSkill(skill)}
                  disabled={isSubmitting || isTxInProgress}
                  className="ml-1 hover:text-rose-500 disabled:opacity-50"
                  aria-label={`Remove ${skill}`}
                  data-testid={`remove-skill-${skill.toLowerCase()}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              id={`${formId}-skills-input`}
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className={cn(
                "flex-1 rounded-2xl border bg-slate-50 px-4 py-3 text-slate-950 outline-none transition",
                errors.skills && skills.length === 0
                  ? "border-rose-500 focus:border-rose-400"
                  : "border-slate-200 focus:border-amber-400",
              )}
              placeholder="Add a skill (press Enter)"
              disabled={isSubmitting || isTxInProgress || skills.length >= 10}
              aria-label="Add skill"
              aria-describedby={errors.skills ? `${formId}-skills-error` : undefined}
              data-testid="skill-input"
            />
            <button
              type="button"
              onClick={handleAddSkill}
              disabled={isSubmitting || isTxInProgress || !skillInput.trim()}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              aria-label="Add skill"
              data-testid="add-skill-btn"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
          {errors.skills && (
            <p
              id={`${formId}-skills-error`}
              className="mt-1.5 text-xs text-rose-500"
              role="alert"
            >
              {errors.skills}
            </p>
          )}
          <p className="mt-1.5 text-xs text-slate-500">
            {skills.length}/10 skills added
          </p>
        </div>

        {/* Budget & Milestones Grid */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${formId}-budget`}
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Budget (USDC)
            </label>
            <input
              type="number"
              id={`${formId}-budget`}
              value={budgetUsdc}
              onChange={(e) => setBudgetUsdc(Number(e.target.value))}
              className={cn(
                "w-full rounded-2xl border bg-slate-50 px-4 py-3 text-slate-950 outline-none transition",
                errors.budgetUsdc
                  ? "border-rose-500 focus:border-rose-400"
                  : "border-slate-200 focus:border-amber-400",
              )}
              required
              min={100}
              aria-invalid={errors.budgetUsdc ? "true" : "false"}
              aria-describedby={errors.budgetUsdc ? `${formId}-budget-error` : undefined}
              disabled={isSubmitting || isTxInProgress}
              data-testid="budget-input"
            />
            {errors.budgetUsdc && (
              <p
                id={`${formId}-budget-error`}
                className="mt-1.5 text-xs text-rose-500"
                role="alert"
              >
                {errors.budgetUsdc}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={`${formId}-payment-type`}
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Payment Type
            </label>
            <select
              id={`${formId}-payment-type`}
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as "fixed" | "milestone")}
              className={cn(
                "w-full rounded-2xl border bg-slate-50 px-4 py-3 text-slate-950 outline-none transition",
                errors.paymentType
                  ? "border-rose-500 focus:border-rose-400"
                  : "border-slate-200 focus:border-amber-400",
              )}
              required
              aria-invalid={errors.paymentType ? "true" : "false"}
              aria-describedby={errors.paymentType ? `${formId}-payment-type-error` : undefined}
              disabled={isSubmitting || isTxInProgress}
              data-testid="payment-type-select"
            >
              <option value="fixed">Fixed Price</option>
              <option value="milestone">Milestone-based</option>
            </select>
            {errors.paymentType && (
              <p
                id={`${formId}-payment-type-error`}
                className="mt-1.5 text-xs text-rose-500"
                role="alert"
              >
                {errors.paymentType}
              </p>
            )}
          </div>
        </div>

        {/* Milestones (conditional) */}
        {paymentType === "milestone" && (
          <div>
            <label
              htmlFor={`${formId}-milestones`}
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Number of Milestones
            </label>
            <input
              type="number"
              id={`${formId}-milestones`}
              value={milestones}
              onChange={(e) => setMilestones(Number(e.target.value))}
              className={cn(
                "w-full rounded-2xl border bg-slate-50 px-4 py-3 text-slate-950 outline-none transition",
                errors.milestones
                  ? "border-rose-500 focus:border-rose-400"
                  : "border-slate-200 focus:border-amber-400",
              )}
              min={1}
              max={20}
              aria-invalid={errors.milestones ? "true" : "false"}
              aria-describedby={errors.milestones ? `${formId}-milestones-error` : undefined}
              disabled={isSubmitting || isTxInProgress}
              data-testid="milestones-input"
            />
            {errors.milestones && (
              <p
                id={`${formId}-milestones-error`}
                className="mt-1.5 text-xs text-rose-500"
                role="alert"
              >
                {errors.milestones}
              </p>
            )}
          </div>
        )}

        {/* Deadline */}
        <div>
          <label
            htmlFor={`${formId}-deadline`}
            className="mb-2 block text-sm font-semibold text-slate-700"
          >
            Deadline
          </label>
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="date"
              id={`${formId}-deadline`}
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className={cn(
                "w-full rounded-2xl border bg-slate-50 px-4 py-3 pl-10 pr-4 text-slate-950 outline-none transition",
                errors.deadline
                  ? "border-rose-500 focus:border-rose-400"
                  : "border-slate-200 focus:border-amber-400",
              )}
              min={today}
              aria-invalid={errors.deadline ? "true" : "false"}
              aria-describedby={errors.deadline ? `${formId}-deadline-error` : undefined}
              disabled={isSubmitting || isTxInProgress}
              data-testid="deadline-input"
            />
          </div>
          {errors.deadline ? (
            <p
              id={`${formId}-deadline-error`}
              className="mt-1.5 text-xs text-rose-500"
              role="alert"
            >
              {errors.deadline}
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              This projected date is attached to the brief so freelancers can plan
              around your expected delivery window.
            </p>
          )}
        </div>

        {/* Transaction Tracker */}
        <TransactionTracker />

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center justify-center rounded-full px-6 py-4 text-sm font-semibold text-white transition",
            "bg-slate-950 hover:bg-slate-800",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "active:translate-y-px",
          )}
          data-testid="submit-job-btn"
        >
          {isSubmitting || isTxInProgress ? (
            <>
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              {txStep === "signing" ? "Waiting for signature..." : "Posting on-chain..."}
            </>
          ) : (
            "Post Job On-Chain"
          )}
        </button>
      </div>
    </form>
  );
}

export { postJobSchema };
export type { PostJobFormData };
