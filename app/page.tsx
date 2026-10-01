import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#0d1117] px-5 text-white">
      <section className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="font-black text-[#ff8a3d]">Wystawiacz</p>
        <h1 className="mt-4 text-4xl font-black">Przygotuj produkty do wystawienia</h1>
        <p className="mt-4 leading-7 text-white/65">Zaloguj się, aby tworzyć listę produktów, edytować opisy i uzupełniać ceny.</p>
        <Link href="/login" className="mt-6 inline-flex rounded-2xl bg-[#ff5a00] px-6 py-3 font-bold">Zaloguj się lub załóż konto</Link>
        <p className="mt-6 text-sm text-white/50">Wersja robocza. Publikacja na Allegro, zdjęcia i płatności nie są jeszcze podłączone.</p>
      </section>
    </main>
  );
}
