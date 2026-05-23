// Thin wrapper around the existing useAuth hook so pages can gate effects on
// "auth has been resolved AND there is a user". This project uses Clerk (or
// Replit cookie auth in fallback mode) — there is NO Supabase client here.
//
// `isReady` flips to true once the /api/auth/user query has finished its first
// fetch (success or 401). `user` is null when unauthenticated.

import { useAuth } from "./use-auth";

export function useAuthReady() {
  const { user, isLoading } = useAuth();
  return {
    user: user ?? null,
    isReady: !isLoading,
  };
}
