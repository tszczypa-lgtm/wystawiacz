import { createSupabaseBrowserClient } from "./supabase";

export type OverrideResult = { message: string; token?: string; resolved?: boolean; kind?: "part" | "vehicle"; foundId?: string | null };
export class ManualOverrideClientError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function resolveManualOvokoOverride(input: { kind: "part" | "vehicle"; offerId: string; brandId: string; modelId: string; year: string; binding?: { sellerId: string; fingerprint: string } }): Promise<OverrideResult> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new ManualOverrideClientError("Zaloguj sie ponownie.", 401);
  const owner = data.session.user.id;
  const request = async (body: unknown) => {
    const current = await createSupabaseBrowserClient().auth.getSession();
    if (current.data.session?.user.id !== owner) throw new ManualOverrideClientError("Sesja zmienila sie. Otworz formularz ponownie.", 401);
    const response = await fetch("/api/ovoko/manual-override", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${current.data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const after = await createSupabaseBrowserClient().auth.getSession();
    if (after.data.session?.user.id !== owner) throw new ManualOverrideClientError("Sesja zmienila sie. Sprawdz wynik po ponownym zalogowaniu.", 401);
    const result = await response.json().catch(() => null) as (OverrideResult & { code?: string }) | null;
    if (!response.ok || !result) throw new ManualOverrideClientError(result?.message || "Nie potwierdzono odblokowania. Nie wyslano czesci; sprawdz ponownie.", response.ok ? 502 : response.status, result?.code);
    return result;
  };
  const preview = await request({ operation: "check", ...input });
  const result = preview.resolved ? preview : preview.token ? await request({ operation: "confirm", token: preview.token, brandId: input.brandId, confirmManual: true }) : null;
  if (!result?.resolved) throw new Error("Nie potwierdzono odblokowania. Nie ponowiono wysylki.");
  return result;
}
