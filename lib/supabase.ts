import { createClient } from "@supabase/supabase-js";

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
  isConfigured: boolean;
};

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

  return {
    url,
    publishableKey,
    isConfigured: Boolean(url && publishableKey),
  };
}

export function createSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();

  if (!config.isConfigured) {
    throw new Error("Brakuje publicznej konfiguracji Supabase.");
  }

  return createClient(config.url, config.publishableKey);
}
