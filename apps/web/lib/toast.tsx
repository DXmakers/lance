"use client";

import { toast as sonnerToast, type ToastT } from "sonner";
import { Loader2, CheckCircle, XCircle, AlertCircle, Info } from "lucide-react";
import type { ReactNode } from "react";

export type ToastType = "info" | "warning" | "success" | "error" | "loading";

export interface ToastOptions {
  id?: string;
  title: string;
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastState {
  id: string | number;
  type: ToastType;
}

const STELLAR_EXPLORER_URL =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

function getIcon(type: ToastType): ReactNode {
  switch (type) {
    case "loading":
      return <Loader2 className="h-4 w-4 animate-spin" />;
    case "success":
      return <CheckCircle className="h-4 w-4" />;
    case "error":
      return <XCircle className="h-4 w-4" />;
    case "warning":
      return <AlertCircle className="h-4 w-4" />;
    case "info":
    default:
      return <Info className="h-4 w-4" />;
  }
}

function createToastContent(
  type: ToastType,
  title: string,
  description?: string,
  txHash?: string
): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 font-medium">
        {getIcon(type)}
        <span>{title}</span>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {txHash && (
        <a
          href={`${STELLAR_EXPLORER_URL}/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:underline mt-1"
          onClick={(e) => e.stopPropagation()}
        >
          View on Stellar Explorer →
        </a>
      )}
    </div>
  );
}

export const toast = {
  info: (options: ToastOptions): ToastState => {
    const id =
      options.id ??
      sonnerToast.info(createToastContent("info", options.title, options.description), {
        duration: options.duration ?? 5000,
      });
    return { id, type: "info" };
  },

  warning: (options: ToastOptions): ToastState => {
    const id =
      options.id ??
      sonnerToast.warning(
        createToastContent("warning", options.title, options.description),
        {
          duration: options.duration ?? 7000,
        }
      );
    return { id, type: "warning" };
  },

  success: (options: ToastOptions & { txHash?: string }): ToastState => {
    const id =
      options.id ??
      sonnerToast.success(
        createToastContent("success", options.title, options.description, options.txHash),
        {
          duration: options.duration ?? 5000,
        }
      );
    return { id, type: "success" };
  },

  error: (options: ToastOptions): ToastState => {
    const id =
      options.id ??
      sonnerToast.error(createToastContent("error", options.title, options.description), {
        duration: options.duration ?? 8000,
      });
    return { id, type: "error" };
  },

  loading: (options: ToastOptions): ToastState => {
    const id = sonnerToast.loading(
      createToastContent("loading", options.title, options.description),
      {
        duration: Infinity,
      }
    );
    return { id, type: "loading" };
  },

  update: (
    state: ToastState,
    newType: Exclude<ToastType, "loading">,
    options: Omit<ToastOptions, "id"> & { txHash?: string }
  ): void => {
    sonnerToast.dismiss(state.id);

    switch (newType) {
      case "success":
        sonnerToast.success(
          createToastContent("success", options.title, options.description, options.txHash),
          {
            duration: options.duration ?? 5000,
          }
        );
        break;
      case "error":
        sonnerToast.error(
          createToastContent("error", options.title, options.description),
          {
            duration: options.duration ?? 8000,
          }
        );
        break;
      case "warning":
        sonnerToast.warning(
          createToastContent("warning", options.title, options.description),
          {
            duration: options.duration ?? 7000,
          }
        );
        break;
      case "info":
        sonnerToast.info(
          createToastContent("info", options.title, options.description),
          {
            duration: options.duration ?? 5000,
          }
        );
        break;
    }
  },

  dismiss: (state: ToastState): void => {
    sonnerToast.dismiss(state.id);
  },

  dismissAll: (): void => {
    sonnerToast.dismiss();
  },
};

export type { ToastState };
