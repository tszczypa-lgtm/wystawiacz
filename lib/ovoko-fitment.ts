import type { OvokoReadRow } from "./ovoko-read";
import { automaticOvokoModel, ovokoModelHasConflict, suggestOvokoBrands } from "./ovoko-suggestions";

export type FitmentRow = { text: string; origin: string };
export async function matchOvokoFitment(rows: FitmentRow[], brands: OvokoReadRow[], allowed: string[], originalText: string, models: (brand: string) => Promise<OvokoReadRow[]>) {
  for (const row of rows) {
    const candidates = suggestOvokoBrands(row.text, brands).filter(brand => !allowed.length || allowed.includes(brand.id));
    for (const brand of candidates) {
      const list = await models(brand.id);
      const modelId = automaticOvokoModel(row.text, list), model = list.find(item => item.id === modelId);
      if (model && !ovokoModelHasConflict(originalText, model)) return { brandId: brand.id, modelId, model, origin: row.origin, text: row.text };
    }
  }
  return null;
}
