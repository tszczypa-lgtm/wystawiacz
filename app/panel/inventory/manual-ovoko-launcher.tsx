"use client";
import { useState } from "react";
export function ManualOvokoLauncher({ offerId }: { offerId: string }) {
  const [error,setError]=useState("");
  const href=`/panel/inventory/prepare-ovoko?offerId=${offerId}&popup=1`;
  return <><a href={href} target="_blank" rel="noopener noreferrer" className="block text-orange-300 underline" onClick={e=>{
    if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
    e.preventDefault();const child=window.open(href,`ovoko-manual-${offerId}`,"popup,width=1150,height=900,scrollbars=yes,resizable=yes");
    if (child) {child.opener=null;child.focus();setError("");} else setError("Przegladarka zablokowala okno. Zezwol na wyskakujace okna albo otworz ten link w nowej karcie.");
  }}>Do Ovoko</a>{error&&<span role="status" className="block text-[10px] text-amber-200">{error}</span>}</>;
}
