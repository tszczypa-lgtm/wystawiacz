import type { ReactNode } from "react";
import { LegalLinks } from "./legal-links";
import { salesPolicy } from "@/lib/sales-policy";

export function SellerDetails() {
  return <address className="not-italic leading-7">
    <strong>{salesPolicy.seller}</strong><br />NIP: {salesPolicy.nip}<br />{salesPolicy.address}<br />
    Kontakt i reklamacje: <a className="text-[#ffb38a] underline" href={`mailto:${salesPolicy.email}`}>{salesPolicy.email}</a>
  </address>;
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
