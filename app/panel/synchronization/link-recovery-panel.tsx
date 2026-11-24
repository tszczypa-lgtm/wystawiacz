"use client";
import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
type Row = { offerId: string; partId: string; name?: string; id?: string; state?: string; expiresAt?: string; message?: string; allegroStatus?: string; ovokoStatus?: string; stock?: number | null };
let lastRequest = 0;
async function request<T>(input: Record<string, unknown>): Promise<T> {
  const session = await createSupabaseBrowserClient().auth.getSession();
  if (!session.data.session) throw new Error("Zaloguj sie ponownie.");
  await new Promise(resolve => setTimeout(resolve, Math.max(0,6250-(Date.now()-lastRequest)))); lastRequest=Date.now();
  const current = await createSupabaseBrowserClient().auth.getSession();
  if (current.data.session?.user.id!==session.data.session.user.id) throw new Error("Konto zmienilo sie. Odswiez strone.");
  const response = await fetch("/api/ovoko/link-recovery", { method:"POST",cache:"no-store",headers:{ Authorization:`Bearer ${current.data.session!.access_token}`,"Content-Type":"application/json" },body:JSON.stringify(input) });
  const data = await response.json() as T & {message?:string};
  if ((await createSupabaseBrowserClient().auth.getSession()).data.session?.user.id!==session.data.session.user.id) throw new Error("Konto zmienilo sie. Odswiez strone.");
  if (!response.ok) throw new Error(data.message||"Nie potwierdzono odzyskiwania.");
  return data as T;
}
export function LinkRecoveryPanel() {
  const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState(new Set<string>()),[busy,setBusy]=useState(false),[error,setError]=useState(""),[next,setNext]=useState<number|null>(1),[info,setInfo]=useState("");
  const [offer,setOffer]=useState(""),[part,setPart]=useState("");
  const lock=useRef(false), stop=useRef(false);
  const key=(r:Row)=>`${r.offerId}:${r.partId}`;
  const update=(row:Row,patch:Partial<Row>)=>setRows(old=>old.map(r=>key(r)===key(row)?{...r,...patch}:r));
  async function run(operation:"discover"|"plans"|"check"|"confirm"|"cancel", single?:Row) {
    if (lock.current) return; lock.current=true; setBusy(true); setError(""); stop.current=false;
    try {
      if (operation==="discover") {
        if (!next) return;
        const data=await request<{rows:Row[];total:number;next:number|null;page:number;skipped:number}>({operation,page:next});
        setRows(data.rows); setNext(data.next);setSelected(new Set());setInfo(`Strona ${data.page}; magazyn Ovoko: ${data.total} czesci. Na tej stronie pominięto ${data.skipped} bez naszego identyfikatora lub z innego konta Allegro. To tylko kandydaci, nie potwierdzone pary.`);
      } else if (operation==="plans") {
        const data=await request<{rows:Row[]}>({operation}); setRows(data.rows);setSelected(new Set());setInfo("Ostatnie 20 planow. Zastosowane plany potwierdzaja zapis w rejestrze, nie aktualny stan aukcji.");
      } else {
        const batch=single?[single]:rows.filter(r=>selected.has(key(r))).slice(0,10);
        for (const row of batch) {
          if (stop.current) break;
          try {
            const data=await request<Row>(operation==="check"?{operation,offerId:row.offerId,partId:row.partId}:{operation,planId:row.id,confirm:true});
            update(row,data);
          } catch(e) { update(row,{message:(e as Error).message}); }
        }
      }
    } catch(e) { setError((e as Error).message); } finally {lock.current=false;setBusy(false);}
  }
  const button="rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40";
  const pending=rows.some(r=>r.state==="prepared");
  return <details className="space-y-2 rounded border border-white/20 p-3 text-xs"><summary className="cursor-pointer font-bold">Odzyskaj powiazania po awarii</summary>
    <p>Odczytujemy identyfikator <code>tymo:kontoAllegro:aukcja</code> z Ovoko. Nie laczymy po OE, nazwie ani zdjeciu. Nie wystawiamy, nie usuwamy i nie zmieniamy aukcji, cen ani stanow.</p>
    <p className="text-amber-200">Przed przygotowaniem planow wylacz oba kierunki synchronizacji i zakoncz trwajace operacje. Plan blokuje ponowne wlaczenie na 5 minut, do zatwierdzenia lub anulowania. Odbudowa NIE odzyskuje rezerwacji, historii sprzedazy ani utraconych zdjec. Synchronizacje wlaczasz osobno od teraz, dopiero po kontroli.</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy||pending||!next} onClick={()=>void run("discover")}>{next===1?"Znajdz kandydatow w Ovoko":"Nastepne 100 czesci Ovoko"}</button><button className={button} disabled={busy||pending} onClick={()=>{setRows([]);setNext(1);setSelected(new Set());setInfo("");}}>Nowy skan</button><button className={button} disabled={busy} onClick={()=>void run("plans")}>Odswiez zapisane plany</button><button className={button} disabled={busy||!selected.size||selected.size>10} onClick={()=>void run("check")}>Sprawdz zaznaczone (maks. 10)</button><button className={`${button} bg-orange-700`} disabled={busy||!selected.size||selected.size>10||rows.some(r=>selected.has(key(r))&&(!r.id||r.state!=="prepared"))} onClick={()=>void run("confirm")}>Zatwierdz odbudowe zaznaczonych powiazan</button>{busy&&<button className={button} onClick={()=>{stop.current=true;}}>Zatrzymaj po biezacej</button>}</div>
    <div className="flex flex-wrap items-center gap-2"><span>Lub wskaz znane ID:</span><input aria-label="ID Allegro do odzyskania" className="rounded bg-white/5 p-1" placeholder="ID aukcji Allegro" value={offer} onChange={e=>setOffer(e.target.value)} /><input aria-label="ID Ovoko do odzyskania" className="rounded bg-white/5 p-1" placeholder="ID czesci Ovoko" value={part} onChange={e=>setPart(e.target.value)} /><button className={button} disabled={busy||!/^\d{1,30}$/.test(offer)||!/^[1-9]\d{0,11}$/.test(part)} onClick={()=>{const r={offerId:offer,partId:part};setRows(old=>old.some(v=>key(v)===key(r))?old:[r,...old]);}}>Dodaj pare do sprawdzenia</button></div>
    {info&&<p className="text-white/60">{info}</p>}{error&&<p role="alert" className="text-amber-200">{error}</p>}{busy&&<p role="status">Sprawdzam kolejno, maksymalnie 10 zadanych operacji na minute. Zostaw strone otwarta.</p>}
    <div className="max-h-96 overflow-auto"><table className="w-full text-left" aria-label="Odzyskiwanie powiazan"><thead><tr><th>Wybor</th><th>Allegro / Ovoko</th><th>Podglad i wynik</th><th>Opcje</th></tr></thead><tbody>{rows.map(row=><tr key={key(row)} className="border-t border-white/10"><td className="p-1"><input type="checkbox" aria-label={`Odzyskaj ${key(row)}`} disabled={busy} checked={selected.has(key(row))} onChange={e=>setSelected(old=>{const n=new Set(old);if(e.target.checked)n.add(key(row));else n.delete(key(row));return n;})} /></td><td className="p-1">A: {row.offerId} / O: {row.partId}<p className="max-w-xs truncate">{row.name}</p></td><td className={`p-1 ${row.state==="applied"?"text-emerald-200":"text-amber-200"}`}>{row.message||({prepared:"Plan gotowy - jeszcze nie odbudowano",applied:"Powiazanie zapisane; bez zmian aukcji",cancelled:"Plan anulowany"}[row.state||""]||"Kandydat - wymaga sprawdzenia")}{row.allegroStatus&&<p>Allegro: {row.allegroStatus}; szt.: {row.stock??"?"}; Ovoko: status {row.ovokoStatus}</p>}{row.expiresAt&&row.state==="prepared"&&<p>Wazny do {new Date(row.expiresAt).toLocaleTimeString("pl-PL")}</p>}</td><td className="p-1"><button className={button} disabled={busy} onClick={()=>void run("check",row)}>Sprawdz pare</button>{row.state==="prepared"&&row.id&&<button className={button} disabled={busy} onClick={()=>void run("cancel",row)}>Anuluj plan</button>}</td></tr>)}</tbody></table></div>
  </details>;
}
