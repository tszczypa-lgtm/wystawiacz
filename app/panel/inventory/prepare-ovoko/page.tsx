import { AccountShell } from "../../account-shell";
import { InventoryViews } from "../inventory-views";
import { OvokoPreparationPanel } from "./preparation-panel";

export default async function OvokoPreparationPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const params=await searchParams;
  if(params.popup==="1")return <main className="min-h-screen bg-[#0d1117] p-4 text-white"><OvokoPreparationPanel popup /></main>;
  return <AccountShell active="/panel/inventory"><InventoryViews active="allegro" /><OvokoPreparationPanel /></AccountShell>;
}
