import { createClient } from "@supabase/supabase-js";

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
  isConfigured: boolean;
};

export function getSupabasePublicConfig(): SupabasePublicConfig {
  // Publishable credentials are public; environment variables can override this project.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Tc8J1YDoJoslkenvJJ8e5w_eMa9GEet";

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
