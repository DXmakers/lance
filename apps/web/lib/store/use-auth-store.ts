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
  /** Unix epoch (ms) when the JWT expires. */
  expiresAt: number | null;
  networkMismatch: boolean;

  setHydrated: (value: boolean) => void;
  setRole: (role: UserRole) => void;
  login: (user: AuthUser, role: Exclude<UserRole, "logged-out">) => void;
  logout: () => void;
  setWalletAddress: (address: string | null) => void;
  setJwt: (token: string | null) => void;
  setNetworkMismatch: (mismatch: boolean) => void;

  /** Called after a successful SIWS → JWT exchange. */
  walletLogin: (
    address: string,
    jwt: string,
    expiresAt: number,
    role: Exclude<UserRole, "logged-out">
  ) => void;
  /** Clears wallet session state. */
  walletLogout: () => void;
  /** Returns true if the current JWT is still valid (not expired). */
  isJwtValid: () => boolean;
}

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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      role: "logged-out",
      isLoggedIn: false,
      user: null,
      hydrated: false,
      walletAddress: null,
      jwt: null,
      expiresAt: null,
      networkMismatch: false,

      setHydrated: (value) => set({ hydrated: value }),

      setRole: (role) =>
        set((state) => ({
          role,
          isLoggedIn: role !== "logged-out",
          user:
            role !== "logged-out"
              ? (state.user ?? {
                  name: role === "client" ? "Client" : "Freelancer",
                  email: role === "client" ? "client@lance.so" : "freelancer@lance.so",
                })
              : null,
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
          role: "logged-out",
          isLoggedIn: false,
          user: null,
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

      walletLogin: (address, jwt, expiresAt, role) => {
        jwtMemory.set(jwt);
        set({
          walletAddress: address,
          jwt,
          expiresAt,
          isLoggedIn: true,
          role,
          user: {
            name: `${address.slice(0, 4)}…${address.slice(-4)}`,
            email: `${address.slice(0, 8).toLowerCase()}@stellar`,
          },
        });
      },

      walletLogout: () => {
        jwtMemory.clear();
        set({
          walletAddress: null,
          jwt: null,
          expiresAt: null,
          isLoggedIn: false,
          role: "logged-out",
          user: null,
        });
      },

      isJwtValid: () => {
        const { jwt, expiresAt } = get();
        if (!jwt || !expiresAt) return false;
        return Date.now() < expiresAt - 30_000;
      },
    }),
    {
      name: "lance-auth-session",
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    }
  )
);
