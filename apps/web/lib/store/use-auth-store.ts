import { create } from "zustand";

export type UserRole = "logged-out" | "client" | "freelancer";

export interface AuthUser {
  name: string;
  email: string;
  avatar?: string;
}

interface AuthState {
  role: UserRole;
  isLoggedIn: boolean;
  user: AuthUser | null;
  hydrated: boolean;
  setHydrated: (value: boolean) => void;
  setRole: (role: UserRole) => void;
  login: (user: AuthUser, role: Exclude<UserRole, "logged-out">) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  role: "logged-out",
  isLoggedIn: false,
  user: null,
  hydrated: false,
  setHydrated: (value) => set({ hydrated: value }),
  setRole: (role) =>
    set((state) => ({
      role,
      isLoggedIn: role !== "logged-out",
      user:
        role === "logged-out"
          ? null
          : state.user ?? {
              name: role === "client" ? "Amina O." : "Tolu A.",
              email: role === "client" ? "client@lance.so" : "freelancer@lance.so",
            },
    })),
  login: (user, role) =>
    set({
      isLoggedIn: true,
      user,
      role,
    }),
  logout: () =>
    set({
      isLoggedIn: false,
      user: null,
      role: "logged-out",
    }),
}));
