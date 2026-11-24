import { AccountShell } from "../account-shell";
import { SalesSyncPanel } from "../inventory/sales-sync-panel";
import { ReverseSyncPanel } from "./reverse-sync-panel";
export default function SynchronizationPage() { return <AccountShell active="/panel/synchronization"><section className="space-y-3"><h1 className="text-xl font-bold">Synchronizacja sprzedazy</h1><p className="text-xs text-white/60">Wycofywanie ofert po sprzedazy. Przenoszenie ofert do Ovoko jest osobna operacja na liscie czesci.</p><SalesSyncPanel /><ReverseSyncPanel /></section></AccountShell>; }
