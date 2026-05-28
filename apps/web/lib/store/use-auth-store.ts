import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserRole = "logged-out" | "client" | "freelancer";

export interface AuthUser {
  name: string;
  email: string;
  avatar?: string;
  address?: string;
  token?: string;
}

interface AuthState {
  role: UserRole;
  isLoggedIn: boolean;
  user: AuthUser | null;
  hydrated: boolean;
  walletAddress: string | null;
  jwt: string | null;
  networkMismatch: boolean;
  setHydrated: (value: boolean) => void;
  setRole: (role: UserRole) => void;
  login: (user: AuthUser, role: Exclude<UserRole, "logged-out">) => void;
  logout: () => void;
  setWalletAddress: (address: string | null) => void;
  setJwt: (token: string | null) => void;
  setNetworkMismatch: (mismatch: boolean) => void;
}

export const jwtMemory = {
  value: null as string | null,
  set(token: string | null) {
    this.value = token;
  },
  get() {
    return this.value;
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      role: "logged-out",
      isLoggedIn: false,
      user: null,
      hydrated: false,
      walletAddress: null,
      jwt: null,
      networkMismatch: false,
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
          walletAddress: user.address ?? null,
          jwt: user.token ?? null,
        }),
      logout: () =>
        set({
          isLoggedIn: false,
          user: null,
          role: "logged-out",
          walletAddress: null,
          jwt: null,
          networkMismatch: false,
        }),
      setWalletAddress: (address) => set({ walletAddress: address }),
      setJwt: (token) => {
        jwtMemory.set(token);
        set({ jwt: token });
      },
      setNetworkMismatch: (mismatch) => set({ networkMismatch: mismatch }),
    }),
    {
      name: "lance-auth-session",
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    }
  )
);
