"use client";

import { UserRound } from "lucide-react";
import { useAuthStore, type UserRole } from "@/lib/store/use-auth-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SESSION_OPTIONS: Array<{
  role: UserRole;
  label: string;
  description: string;
}> = [
  {
    role: "logged-out",
    label: "Visitor",
    description: "See the public marketplace experience.",
  },
  {
    role: "client",
    label: "Client",
    description: "Review hiring, escrow, and talent tools.",
  },
  {
    role: "freelancer",
    label: "Freelancer",
    description: "Review discovery, contracts, and payouts.",
  },
];

export function SessionSwitcher() {
  const { role, setRole } = useAuthStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-10 rounded-full border-border/70 bg-card/70 px-4 backdrop-blur"
        >
          <UserRound className="mr-2 h-4 w-4" />
          {SESSION_OPTIONS.find((option) => option.role === role)?.label ?? "Visitor"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Preview navigation by role</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SESSION_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.role}
            onClick={() => setRole(option.role)}
            className="flex flex-col items-start gap-1"
          >
            <span>{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
