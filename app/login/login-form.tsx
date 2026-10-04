"use client";

import { useState } from "react";
import { LockKeyhole, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type Mode = "login" | "signup";

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const supabase = createSupabaseBrowserClient();
      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage("Konto utworzone. Sprawdz email i potwierdz rejestracje.");
        return;
      }

      window.location.assign("/panel");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nie udalo sie zalogowac.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-bold">
        Email
        <span className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3">
          <Mail className="h-4 w-4 text-slate-400" />
          <input
            className="w-full outline-none"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="firma@example.pl"
            required
            type="email"
            value={email}
          />
        </span>
      </label>

      <label className="grid gap-2 text-sm font-bold">
        Haslo
        <span className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3">
          <LockKeyhole className="h-4 w-4 text-slate-400" />
          <input
            className="w-full outline-none"
            minLength={6}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="minimum 6 znakow"
            required
            type="password"
            value={password}
          />
        </span>
      </label>

      {message ? (
        <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
          {message}
        </p>
      ) : null}

      <button
        className="mt-2 inline-flex justify-center rounded-2xl bg-[#ff5a00] px-5 py-3 font-black text-white disabled:cursor-wait disabled:opacity-60"
        disabled={isLoading}
        type="submit"
      >
        {isLoading ? "Pracuje..." : mode === "login" ? "Zaloguj" : "Zaloz konto"}
      </button>

      <button
        className="text-sm font-bold text-[#ff5a00]"
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setMessage("");
        }}
        type="button"
      >
        {mode === "login" ? "Nie mam konta - zaloz nowe" : "Mam juz konto - zaloguj"}
      </button>
    </form>
  );
}
