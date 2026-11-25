import type { OvokoReadRow } from "./ovoko-read";
import { automaticOvokoModel, ovokoModelHasConflict, suggestOvokoBrands, suggestOvokoModels } from "./ovoko-suggestions";

export type FitmentRow = { text: string; origin: string };
export async function matchOvokoFitment(rows: FitmentRow[], brands: OvokoReadRow[], allowed: string[], originalText: string, models: (brand: string) => Promise<OvokoReadRow[]>, requireUnique = false) {
  for (const row of rows) {
    const candidates = suggestOvokoBrands(row.text, brands).filter(brand => !allowed.length || allowed.includes(brand.id));
    for (const brand of candidates) {
      const list = await models(brand.id);
      if (requireUnique) {
        const ranked = suggestOvokoModels(row.text, list).filter(item => !item.generationConflict && !item.chassisConflict);
        if (ranked.filter(item => item.score === ranked[0]?.score).length !== 1) continue;
      }
      const modelId = automaticOvokoModel(row.text, list), model = list.find(item => item.id === modelId);
      if (model && !ovokoModelHasConflict(originalText, model)) return { brandId: brand.id, modelId, model, origin: row.origin, text: row.text };
    }
  }
  return null;
}
