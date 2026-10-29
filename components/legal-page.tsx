import type { ReactNode } from "react";
import { LegalLinks } from "./legal-links";
import { salesPolicy } from "@/lib/sales-policy";
import { salesDocuments, salesDocumentPath, type SalesDocumentName } from "@/lib/sales-documents";

export function SellerDetails() {
  return <address className="not-italic leading-7">
    <strong>{salesPolicy.seller}</strong><br />NIP: {salesPolicy.nip}<br />{salesPolicy.address}<br />
    Kontakt i reklamacje: <a className="text-[#ffb38a] underline" href={`mailto:${salesPolicy.email}`}>{salesPolicy.email}</a>
  </address>;
}
export function SalesDocumentPage({ name }: { name: SalesDocumentName }) {
  const document = salesDocuments[name];
  return <LegalPage title={document.title} draft={!salesPolicy.published}>
    <p>Wersja: {salesPolicy.version}. <a href={salesDocumentPath(name)} download>Pobierz tę wersję dokumentu (TXT)</a>.</p>
    {document.sections.map(section => <section key={section.title}>
      <h2>{section.title}</h2>
      {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
    </section>)}
  </LegalPage>;
}
export function LegalPage({ title, children, draft = false }: { title: string; children: ReactNode; draft?: boolean }) {
  return <main className="min-h-screen bg-[#0d1117] px-5 py-10 text-white">
    <article className="mx-auto max-w-3xl space-y-7 leading-8">
      <header><a href="/" className="font-bold text-[#ff8a3d]">Wystawiacz by Tymo</a><h1 className="mt-5 text-4xl font-black">{title}</h1></header>
      {draft && <aside role="note" className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-5 text-amber-100">
        Projekt do zatwierdzenia, nie końcowy dokument sprzedaży. Wersja {salesPolicy.version}. Sprzedaż produkcyjna jest zablokowana do czasu uzupełnienia i sprawdzenia dokumentów. Projekt wymaga sprawdzenia prawnego przed przyjmowaniem opłat.
      </aside>}
      <div className="space-y-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_p]:text-white/75 [&_a]:text-[#ffb38a]">{children}</div>
      <footer className="border-t border-white/10 pt-6 text-white/60"><LegalLinks /></footer>
    </article>
  </main>;
}
