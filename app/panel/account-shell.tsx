import { LogoutButton } from "./logout-button";
import { AdminLink } from "./admin-link";

export function AccountShell({ children, active }: { children: React.ReactNode; active: string }) {
  const links = [["/panel", "Panel konta"], ["/panel/offers", "Wystawianie ofert"], ["/panel/billing", "Abonament"], ["/panel/allegro", "Allegro"], ["/panel/settings", "Ustawienia"]];
  return (
    <main className="min-h-screen bg-[#0d1117] text-white">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
        <a href="/panel" className="text-xl font-black text-[#ff8a3d]">Tymo Garage · Wystawiacz</a>
        <div className="w-36"><LogoutButton /></div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 p-5 md:grid-cols-[220px_1fr] md:p-8">
        <nav aria-label="Panel konta" className="flex flex-wrap gap-2 self-start md:grid">
          {links.map(([href, label]) => <a key={href} href={href} aria-current={active === href ? "page" : undefined} className={`rounded-xl px-4 py-3 font-bold ${active === href ? "bg-[#ff5a00] text-white" : "bg-white/5 text-white/70 hover:bg-white/10"}`}>{label}</a>)}
          <AdminLink />
          <a href="/docs" className="px-4 py-3 text-sm text-white/55">Dokumentacja</a>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
