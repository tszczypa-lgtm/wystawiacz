import { salesDocumentPath, salesDocumentText, type SalesDocumentName } from "@/lib/sales-documents";
import { salesDocumentPath as archivedPath, salesDocumentText as archivedText } from "@/lib/sales-documents-2026-10-28";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const name = (["regulamin", "prywatnosc"] as SalesDocumentName[]).find(name => salesDocumentPath(name) === `/dokumenty/${file}`);
  const archived = (["regulamin", "prywatnosc"] as SalesDocumentName[]).find(name => archivedPath(name) === `/dokumenty/${file}`);
  if (!name && !archived) return new Response("Nie znaleziono tej wersji dokumentu.", { status: 404 });
  return new Response(name ? salesDocumentText(name) : archivedText(archived!), { headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="${file}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
