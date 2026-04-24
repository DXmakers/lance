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

export const useAuthStore = create<AuthState>((set) => ({
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
              email:
                role === "client"
                  ? "client@lance.so"
                  : "freelancer@lance.so",
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
      walletAddress: null,
      jwt: null,
      networkMismatch: false,
    }),

  setWalletAddress: (address) => set({ walletAddress: address }),
  setJwt: (token) => set({ jwt: token }),
  setNetworkMismatch: (mismatch) => set({ networkMismatch: mismatch }),
}));

// In-memory JWT accessor — used by the API interceptor without React
let _jwt: string | null = null;
export const jwtMemory = {
  get: () => _jwt,
  set: (token: string | null) => {
    _jwt = token;
  },
  clear: () => {
    _jwt = null;
  },
};