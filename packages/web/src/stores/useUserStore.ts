import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
  name?: string;
}

interface UserStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: User) => void;
  setToken: (token: string) => void;
  login: (user: User, token: string) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

const STORAGE_KEY = 'lifespan-user-storage';

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,

  setUser: (user) => {
    set({ user, isAuthenticated: !!user });
    saveToStorage({ user, token: useUserStore.getState().token, isAuthenticated: !!user });
  },

  setToken: (token) => {
    set({ token });
    saveToStorage({ user: useUserStore.getState().user, token, isAuthenticated: useUserStore.getState().isAuthenticated });
  },

  login: (user, token) => {
    const state = { user, token, isAuthenticated: true };
    set(state);
    saveToStorage(state);
  },

  logout: () => {
    const state = { user: null, token: null, isAuthenticated: false };
    set(state);
    saveToStorage(state);
  },

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        set(data);
      }
    } catch (error) {
      console.error('Failed to load user from storage:', error);
    }
  },
}));

function saveToStorage(state: Partial<UserStore>) {
  try {
    const toSave = {
      user: state.user,
      token: state.token,
      isAuthenticated: state.isAuthenticated,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (error) {
    console.error('Failed to save user to storage:', error);
  }
}

// Initialize store from localStorage
if (typeof window !== 'undefined') {
  useUserStore.getState().loadFromStorage();
}
