import Link from "next/link";
import { CreditCard, LayoutDashboard, PlugZap, Settings, Store } from "lucide-react";
import { AuthGuard } from "./auth-guard";
import { LogoutButton } from "./logout-button";

const links = [
  { href: "/panel", label: "Panel", icon: LayoutDashboard },
  { href: "/panel/allegro", label: "Allegro", icon: PlugZap },
  { href: "/panel/billing", label: "Abonament", icon: CreditCard },
  { href: "/panel/settings", label: "Ustawienia", icon: Settings },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <main className="min-h-screen bg-[#0d1117] text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[250px_1fr]">
          <aside className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-4 lg:min-h-[calc(100vh-40px)]">
            <Link href="/" className="mb-8 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ff5a00] font-black">
                A
              </span>
              <span>
                <span className="block font-black">Wystawiacz</span>
                <span className="block text-xs text-white/50">Tymo Garage</span>
              </span>
            </Link>

            <nav className="grid gap-2">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-white/72 hover:bg-white/10 hover:text-white"
                >
                  <Icon className="h-4 w-4 text-[#ff8a3d]" />
                  {label}
                </Link>
              ))}
            </nav>

            <div className="mt-8 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4">
              <Store className="mb-3 h-5 w-5 text-emerald-300" />
              <p className="text-sm font-black text-emerald-100">Wersja robocza</p>
              <p className="mt-1 text-xs leading-5 text-emerald-100/65">
                Na razie panel sprawdza logowanie. Abonament podlaczymy po Stripe.
              </p>
            </div>

            <LogoutButton />
          </aside>

          <section className="min-w-0">{children}</section>
        </div>
      </main>
    </AuthGuard>
  );
}
