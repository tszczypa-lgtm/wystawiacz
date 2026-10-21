import { accountContext, type AccountEnv } from "./account-api";
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;

export async function handleWorkspaceApi(request: Request, env: AccountEnv) {
  const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const context = await accountContext(request, env);
    if (context.account.suspended) return reply({ message: "Konto zawieszone." }, 403);
    const url = new URL(request.url);
    const path = url.pathname.slice("/api/workspace".length);
    if (path === "/preferences" && request.method === "GET") {
      const rows = await context.db(`workspace_preferences?owner_id=eq.${context.user.id}&select=description_template`) as { description_template: string }[];
      return reply({ descriptionTemplate: rows[0]?.description_template ?? null });
    }
    if (path === "/preferences" && request.method === "PUT") {
      if (request.headers.get("Origin") !== url.origin) return reply({ message: "Nieprawidlowe zrodlo." }, 403);
      const raw = await request.text();
      if (raw.length > 50000) return reply({ message: "Szablon jest zbyt dlugi." }, 413);
      const input = JSON.parse(raw);
      if (typeof input.descriptionTemplate !== "string" || input.descriptionTemplate.length > 20000) return reply({ message: "Nieprawidlowy szablon. Maksymalnie 20000 znakow." }, 400);
      let templateText = input.descriptionTemplate;
      let template;
      try { template = JSON.parse(templateText); } catch { /* Legacy templates are plain text. */ }
      if (template?.format === "wystawiacz-description-v2") {
        if (typeof template.text !== "string") return reply({ message: "Brak tekstu szablonu." }, 400);
        templateText = template.text;
      }
      if (templateText.split("{{AUTO}}").length > 2 || templateText.split("{{TYTUL}}").length > 2) return reply({ message: "Szablon moze miec jeden blok auta i jeden tytul." }, 400);
      await context.db("workspace_preferences?on_conflict=owner_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ owner_id: context.user.id, description_template: input.descriptionTemplate }) });
      return reply({ ok: true });
    }
    if (request.method === "GET" && path === "/sessions") return reply({ sessions: await context.db(`workspace_sessions?owner_id=eq.${context.user.id}&select=id,name,revision,updated_at&order=updated_at.desc&limit=100`) });
    if (request.method === "GET" && path === "/session") {
      const id = url.searchParams.get("id") || "";
      if (!uuid.test(id)) return reply({ message: "Nieprawidlowa sesja." }, 400);
      const revision = url.searchParams.get("revision");
      if (revision && !/^\d+$/.test(revision)) return reply({ message: "Nieprawidlowa wersja." }, 400);
      const rows = await context.db(revision
        ? `workspace_session_versions?owner_id=eq.${context.user.id}&session_id=eq.${id}&revision=eq.${revision}&select=payload,revision`
        : `workspace_sessions?owner_id=eq.${context.user.id}&id=eq.${id}&select=payload,revision`) as { payload: unknown; revision: number }[];
      if (!rows[0]) return reply({ message: "Nie znaleziono sesji." }, 404);
      return reply(rows[0]);
    }
    if (request.method === "GET" && path === "/versions") {
      const id = url.searchParams.get("id") || "";
      if (!uuid.test(id)) return reply({ message: "Nieprawidlowa sesja." }, 400);
      return reply({ versions: await context.db(`workspace_session_versions?owner_id=eq.${context.user.id}&session_id=eq.${id}&select=revision,created_at&order=revision.desc&limit=20`) });
    }
    if (request.method === "PUT" && path === "/session") {
      if (request.headers.get("Origin") !== url.origin) return reply({ message: "Nieprawidlowe zrodlo." }, 403);
      if (Number(request.headers.get("Content-Length")) > 5 * 1024 * 1024) return reply({ message: "Sesja przekracza 5 MB." }, 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 5 * 1024 * 1024) return reply({ message: "Sesja przekracza 5 MB." }, 413);
      const input = JSON.parse(raw);
      if (typeof input.id !== "string" || !uuid.test(input.id) || !Number.isInteger(input.revision) || input.revision < 0 || input.payload?.format !== "wystawiacz-allegro-session" || !Array.isArray(input.payload.products) || input.payload.products.length > 2000) return reply({ message: "Nieprawidlowa sesja." }, 400);
      // Images remain on the user's computer; only listing data enters the database.
      for (const product of input.payload.products) {
        if (!product || typeof product !== "object" || !Array.isArray(product.photoNames)) return reply({ message: "Nieprawidlowa pozycja." }, 400);
        delete product.image;
      }
      const result = await context.db("rpc/save_workspace_session", { method: "POST", body: JSON.stringify({ p_owner: context.user.id, p_id: input.id, p_revision: input.revision, p_payload: input.payload }) }) as { conflict?: boolean; revision?: number };
      return reply(result, result.conflict ? 409 : 200);
    }
    return reply({ message: "Nieznana operacja." }, 404);
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 401) return reply({ message: "Sesja wygasla. Zaloguj sie ponownie." }, 401);
    return reply({ message: "Nie udalo sie obsluzyc sesji. Sprawdz logowanie i migracje 004; lokalny eksport pozostaje dostepny." }, 503);
  }
}
