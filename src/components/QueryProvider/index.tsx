"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient, getQueryClient } from "@/lib/query-client";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Shared with non-React helpers (fetchPersonas etc.) so there is one cache.
  const [queryClient] = useState(() =>
    typeof window === "undefined" ? createQueryClient() : getQueryClient(),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export default QueryProvider;
