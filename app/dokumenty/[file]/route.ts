import { salesDocumentPath, salesDocumentText, type SalesDocumentName } from "@/lib/sales-documents";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const name = (["regulamin", "prywatnosc"] as SalesDocumentName[]).find(name => salesDocumentPath(name) === `/dokumenty/${file}`);
  if (!name) return new Response("Nie znaleziono tej wersji dokumentu.", { status: 404 });
  return new Response(salesDocumentText(name), { headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="${file}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
