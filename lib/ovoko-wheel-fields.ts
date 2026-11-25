import {OvokoError,type OvokoReadRow} from "./ovoko-read";
import type {OvokoSourcePreview} from "./ovoko-preparation";

export const wheelKeys=["quantity","width","height","treadDepth","fixingPoints","spacing","centralDiameter"] as const;
export function validateWheelInput(value:unknown):Record<string,string>{
 if(value===undefined)return {};
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!wheelKeys.includes(key as typeof wheelKeys[number]))||Object.values(value).some(item=>typeof item!=="string"||item.length>32||/\0/.test(item)))throw new OvokoError(400,"Sprawdz dane opon lub felg.");
 return value as Record<string,string>;
}
const fold=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ł/g,"l").toLowerCase();
export function wheelCategory(rows:OvokoReadRow[],id:string){
 const leaf=fold(rows.find(row=>row.id===id)?.name||"");
 if(/czujn|srub|nakret|kolpak|zawor|sensor|bolt|nut|cover|valve/.test(leaf))return "";
 const tire=/opon|\btires?\b|\btyres?\b/.test(leaf),rim=/felg|\brims?\b|alloy wheel|steel wheel/.test(leaf);
 if(tire&&rim)return "both";
 if(tire)return "tires";
 if(rim)return "rims";
 return "";
}
const numberKey=(value:string)=>{const clean=value.trim().replace(",",".").replace(/\s*(mm|szt\.?|pcs\.?)$/i,"");return /^\d+(\.\d+)?$/.test(clean)?String(Number(clean)):clean;};
export async function ovokoWheelFields(source:OvokoSourcePreview,rows:OvokoReadRow[],categoryId:string,remote:(path:string)=>Promise<Record<string,any>>,value?:unknown){
 const input=validateWheelInput(value),type=wheelCategory(rows,categoryId);
 if(!type){if(Object.values(input).some(Boolean))throw new OvokoError(400,"Dane kol wymagaja kategorii opon albo felg.");return {};}
 const param=(pattern:RegExp)=>{
  const found=source.parameters.filter(row=>pattern.test(fold(row.name))).flatMap(row=>row.values).map(numberKey);
  return new Set(found).size===1?found[0]:"";
 };
 const tire=source.title.match(/\b(\d{3})\s*\/\s*(\d{2})\s*(?:[ZR]*\s*\d{2})?\b/i);
 const pcdPattern=/\b([3-9]|1[0-2])\s*[x×]\s*(\d{2,3}(?:[.,]\d+)?)\b/i;
 const spacing=param(/rozstaw.*srub|bolt.*pattern|pcd/);
 const pcd=(spacing||source.title).match(pcdPattern);
 const packageCount=source.title.match(/\b([1-5])\s*(?:szt\.?|pcs|opony|felgi)\b/i)?.[1];
 const quantity=input.quantity||param(/liczba.*(opon|felg|komplec)|ilosc.*komplec|quantity.*(tyre|tire|rim)/)||packageCount||(source.stockUnit==="PAIR"?"2":!source.stockUnit||source.stockUnit==="UNIT"?"1":"");
 const hasTire=type!=="rims",hasRim=type!=="tires";
 const fields:Record<string,string>={tires:hasTire?"1":"0",rims:hasRim?"1":"0"};
 if(quantity){if(!/^[1-5]$/.test(quantity))throw new OvokoError(400,"Liczba opon/felg w jednej sprzedawanej pozycji: od 1 do 5. To nie jest zapas magazynowy.");if(hasTire)fields.tires_quantity=quantity;if(hasRim)fields.rims_quantity=quantity;}
 const values=[...(hasTire?[
  ["width","tires_width","/get/wheels_width",param(/szerokosc.*opon|tire width|tyre width/)||tire?.[1]||"","Szerokosc opony"],
  ["height","tires_height","/get/wheels_height",param(/profil.*opon|wysokosc.*opon|aspect ratio/)||tire?.[2]||"","Profil opony"],
  ["treadDepth","tires_tread_depth","/get/wheels_tread_depth",param(/glebokosc.*bieznik|wysokosc.*bieznik|tread depth/),"Bieznik"]
 ]:[]),...(hasRim?[
  ["fixingPoints","rims_fixing_points","/get/wheels_fixing_points",param(/liczba.*otwor|fixing points/)||pcd?.[1]||"","Liczba otworow"],
  ["spacing","rims_spacing","/get/wheels_spacing",spacing.match(pcdPattern)?.[2]||spacing||pcd?.[2]||"","Rozstaw srub"],
  ["centralDiameter","rims_central_diameter","/get/wheels_central_diameter",param(/otwor.*central|central.*(hole|diameter)/)||source.title.match(/\b(?:DIA|CB)\s*[:=]?\s*(\d{2,3}(?:[.,]\d+)?)\b/i)?.[1]||"","Otwor centralny"]
 ]:[])];
 for(const [key,field,path,automatic,label] of values){
  const wanted=input[key]||automatic;if(!wanted)continue;
  const result=await remote(path);
  if(!result.list||typeof result.list!=="object"||Array.isArray(result.list))throw new OvokoError(502,"Nie odczytano slownika kol Ovoko.");
  const matches=Object.entries(result.list).filter(([id,row])=>/^\d{1,12}$/.test(id)&&row&&typeof row==="object"&&["pl","en"].some(lang=>typeof (row as Record<string,unknown>)[lang]==="string"&&numberKey(String((row as Record<string,unknown>)[lang]))===numberKey(wanted)));
  if(matches.length===1)fields[field]=matches[0][0];
  else if(input[key])throw new OvokoError(400,`${label}: wartosc ${wanted} nie ma jednoznacznego odpowiednika w Ovoko.`);
 }
 return fields;
}
