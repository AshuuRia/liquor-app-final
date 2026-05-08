import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { isClerkMode, getClerk, getClerkToken } from "@/lib/clerk";

async function fetchUser(): Promise<User | null> {
  const headers: Record<string, string> = {};

  if (isClerkMode()) {
    const token = await getClerkToken();
    if (!token) return null;
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch("/api/auth/user", {
    credentials: "include",
    headers,
  });

  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
  return response.json();
}

async function logout(): Promise<void> {
  if (isClerkMode()) {
    const clerk = getClerk();
    if (clerk) await clerk.signOut();
  } else {
    window.location.href = "/api/logout";
  }
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
