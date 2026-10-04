import { LockKeyhole, ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-[#0d1117] px-5 py-10 text-white lg:grid-cols-[0.92fr_1.08fr]">
      <section className="mx-auto flex w-full max-w-xl flex-col justify-center">
        <a href="/" className="mb-10 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ff5a00] font-black">
            A
          </span>
          <span>
            <span className="block text-lg font-black">Wystawiacz</span>
            <span className="block text-sm text-white/55">konto firmowe</span>
          </span>
        </a>

        <p className="mb-4 inline-flex w-fit rounded-full border border-[#ff5a00]/35 bg-[#ff5a00]/10 px-4 py-2 text-sm font-bold text-[#ffb38a]">
          Logowanie do panelu
        </p>
        <h1 className="text-4xl font-black tracking-[-0.05em] sm:text-5xl">
          Twoje konto firmowe w Wystawiaczu.
        </h1>
        <p className="mt-5 text-lg leading-8 text-white/62">
          Zarejestruj firmę, potwierdź e-mail i wejdź do panelu konta. Rejestracja nie uruchamia płatności. Abonament i dane do faktury znajdziesz w rozliczeniach.
        </p>

        <div className="mt-8 grid gap-3 text-sm text-white/70">
          <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.04] p-4">
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" />
            Hasło potwierdzasz podczas rejestracji. Sekrety Allegro pozostają na serwerze.
          </div>
          <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.04] p-4">
            <LockKeyhole className="h-5 w-5 shrink-0 text-emerald-300" />
            Dostęp kontroluje administrator lub opłacony abonament. W wersji roboczej płatność może nie być wymagana.
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-xl items-center">
        <div className="w-full rounded-[2rem] border border-white/10 bg-white/[.07] p-5 shadow-2xl">
          <div className="rounded-[1.5rem] bg-white p-6 text-[#172033]">
            <h2 className="text-2xl font-black tracking-tight">Wejdz do panelu</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Uzyj emaila i hasla. Jezeli konta jeszcze nie ma, kliknij rejestracje.
            </p>
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}
