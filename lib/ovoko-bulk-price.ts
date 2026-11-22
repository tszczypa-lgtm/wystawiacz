export type OvokoPriceAdjustment = { mode: "none" | "amount" | "percent"; value: string };
export function validateOvokoAdjustment(input: unknown): OvokoPriceAdjustment {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Wybierz sposob zmiany ceny.");
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => !["mode", "value"].includes(key)) || !["none", "amount", "percent"].includes(String(row.mode)) || typeof row.value !== "string" || !/^[+-]?\d{1,7}(\.\d{1,2})?$/.test(row.value)) throw new Error("Korekta ceny: wpisz kwote lub procent, maksymalnie 2 miejsca po przecinku.");
  if (row.mode === "none" && Number(row.value) !== 0) throw new Error("Bez zmiany ceny wymaga korekty 0.");
  if (row.mode === "percent" && (Number(row.value) <= -100 || Number(row.value) > 1000)) throw new Error("Procent musi byc wiekszy niz -100 i nie wiekszy niz 1000.");
  return { mode: row.mode as OvokoPriceAdjustment["mode"], value: row.value.replace(/^\+/, "") };
}
export function adjustedOvokoPrice(source: string, currency: string, input: unknown): string {
  const adjustment = validateOvokoAdjustment(input);
  if (!/^(PLN|EUR)$/.test(currency) || !/^\d{1,10}(\.\d{1,2})?$/.test(source)) throw new Error("Brak prawidlowej ceny PLN/EUR. Nie przewalutowujemy.");
  const scaled = (value: string) => {
    const negative = value.startsWith("-"), [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
    return negative ? -result : result;
  };
  const cents = scaled(source), delta = scaled(adjustment.value);
  const result = adjustment.mode === "amount" ? cents + delta : adjustment.mode === "percent" ? (cents * (BigInt(10000) + delta) + BigInt(5000)) / BigInt(10000) : cents;
  if (result <= BigInt(0) || result > BigInt(999999999999)) throw new Error("Cena po korekcie musi byc dodatnia i miescic sie w limicie Ovoko.");
  return `${result / BigInt(100)}.${String(result % BigInt(100)).padStart(2, "0")}`;
}
