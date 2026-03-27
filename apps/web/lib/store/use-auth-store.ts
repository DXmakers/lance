import { create } from 'zustand';

export type UserRole = 'logged-out' | 'client' | 'freelancer' | 'admin';

interface AuthState {
  role: UserRole;
  isLoggedIn: boolean;
  user: {
    name: string;
    email: string;
    avatar?: string;
  } | null;
  setRole: (role: UserRole) => void;
  login: (name: string, email: string, role: UserRole) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  role: 'logged-out',
  isLoggedIn: false,
  user: null,
  setRole: (role) => set({ role }),
  login: (name, email, role) => set({ 
    isLoggedIn: true, 
    user: { name, email }, 
    role 
  }),
  logout: () => set({ 
    isLoggedIn: false, 
    user: null, 
    role: 'logged-out' 
  }),
}));
