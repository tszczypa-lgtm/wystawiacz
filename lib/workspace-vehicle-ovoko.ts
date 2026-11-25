import {accountContext} from "./account-api";
import {requireOvokoAccess} from "./ovoko-access";
import {loadOvokoConnection,ovokoConnectionKey} from "./ovoko-connection";
import type {OvokoPublishEnv} from "./ovoko-publish";
import {OvokoError,parseOvokoRead} from "./ovoko-read";
import {ovokoWriteClient,ovokoWriteDigest} from "./ovoko-write-client";
import {readWorkspaceVehicle} from "./workspace-vehicles";

type Context=Awaited<ReturnType<typeof accountContext>>;
export async function workspaceVehicleOvoko(request:Request,env:OvokoPublishEnv,context:Context,id:unknown,create=false){
 if(env.OVOKO_PUBLISH_ENABLED!=="true")throw new OvokoError(503,"Publikacja Ovoko jest wylaczona.");
 const vehicle=await readWorkspaceVehicle(context,id),data=vehicle.payload.ovoko;
 if(!data)throw new OvokoError(400,"Uzupelnij dane Ovoko w Moich samochodach i zapisz auto.");
 const credentials=await loadOvokoConnection(context,await ovokoConnectionKey(env));
 const account=await ovokoWriteDigest(credentials.username.trim().toLowerCase()),remote=ovokoWriteClient(credentials);
 const hash=await ovokoWriteDigest(JSON.stringify(data));
 const selector=`owner_id=eq.${context.user.id}&vehicle_id=eq.${vehicle.id}&ovoko_account=eq.${account}`;
 const db=async(path:string,options?:RequestInit)=>{
  try{return await context.db(path,options);}catch{throw new OvokoError(503,"Nie odczytano rejestru Moich samochodow. Sprawdz migracje 027 w Supabase.");}
 };
 const verify=async(carId:string)=>{
  const result=await remote(`/get/car/${carId}`);
  const car=Array.isArray(result.list)&&result.list.length===1&&Array.isArray(result.list[0])&&result.list[0].length===1?result.list[0][0]:null;
  if(!car||String(car.id)!==carId||String(car.car_model)!==data.modelId||String(car.car_years)!==data.year||data.vin&&String(car.car_body_number).trim().toUpperCase()!==data.vin)throw new OvokoError(409,"Dane konkretnego dawcy w Ovoko nie zgadzaja sie z zapisanym samochodem. Nie przypisano czesci do innego auta.");
  return {ok:true,carId,brandId:data.brandId,modelId:data.modelId,year:data.year};
 };
 const links=await db(`workspace_vehicle_ovoko?${selector}&select=*`);
 if(!Array.isArray(links)||links.length>1)throw new OvokoError(503,"Nieprawidlowy rejestr samochodow.");
 if(links.length){
  const link=links[0];
  if(link.request_hash!==hash)throw new OvokoError(409,"Zmienily sie dane polaczonego samochodu.");
  if(link.state==="created"&&/^[1-9]\d{0,11}$/.test(link.car_id))return verify(link.car_id);
  throw new OvokoError(409,"Poprzednie tworzenie tego konkretnego auta nie zostalo potwierdzone. Sprawdz Ovoko; nie tworzymy duplikatu.");
 }
 if(!create)throw new OvokoError(400,"Najpierw utworz ten samochod w Ovoko w oknie Moje samochody.");
 const model=parseOvokoRead("models",await remote(`/get/car_models/${data.brandId}`),data.brandId).rows.find(row=>row.id===data.modelId);
 if(!model)throw new OvokoError(400,"Model nie nalezy do wybranej marki.");
 const range=model.years?.match(/^(\d{4})? - (\d{4})?$/);
 if(range&&(range[1]&&+data.year<+range[1]||range[2]&&+data.year>+range[2]))throw new OvokoError(400,"Rok nie pasuje do wybranego modelu.");
 const statuses=await remote("/get/car_status");
 const added=Object.entries((statuses.list||{}) as Record<string,{pl?:string;en?:string}>).filter(([key,row])=>/^[1-9]\d{0,11}$/.test(key)&&[row?.pl,row?.en].some(value=>["dodano","added"].includes(String(value).trim().toLowerCase())));
 if(added.length!==1)throw new OvokoError(502,"Nie potwierdzono statusu Dodano dla samochodu.");
 const permission=await accountContext(request,env);requireOvokoAccess(permission,env);
 if(permission.user.id!==context.user.id||JSON.stringify(await loadOvokoConnection(permission,await ovokoConnectionKey(env)))!==JSON.stringify(credentials))throw new OvokoError(409,"Konto zmienilo sie. Nie utworzono auta.");
 const attempt=crypto.randomUUID();
 const reserved=await db("rpc/reserve_workspace_vehicle",{method:"POST",body:JSON.stringify({p_owner:context.user.id,p_vehicle:vehicle.id,p_payload:vehicle.payload,p_account:account,p_hash:hash,p_attempt:attempt})});
 if(!Array.isArray(reserved)||reserved.length!==1||reserved[0].attempt_id!==attempt)throw new OvokoError(409,"Auto jest juz tworzone albo zmienilo sie w innej karcie. Odswiez Moje samochody.");
 try{
  const fields:Record<string,string>={car_model:data.modelId,car_years:data.year,status:added[0][0],external_id:`tymo:vehicle:${context.user.id}:${vehicle.id}`};
  for(const [key,target] of Object.entries({vin:"car_body_number",engineCode:"car_engine_code",capacity:"car_engine_cubic_capacity",power:"car_engine_power",mileage:"car_mileage",color:"car_color",place:"place"}))if(data[key as keyof typeof data])fields[target]=data[key as keyof typeof data];
  const result=await remote("/crm/importCar",new URLSearchParams(fields)),carId=String(result.car_id);
  if(!/^[1-9]\d{0,11}$/.test(carId))throw new Error("missing car id");
  const verified=await verify(carId);
  const saved=await db(`workspace_vehicle_ovoko?${selector}&attempt_id=eq.${attempt}&state=eq.sending`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({state:"created",car_id:carId,updated_at:new Date().toISOString()})});
  if(!Array.isArray(saved)||saved.length!==1||saved[0].car_id!==carId||saved[0].state!=="created"||saved[0].attempt_id!==attempt)throw new Error("journal confirmation");
  return verified;
 }catch{
  try{await db(`workspace_vehicle_ovoko?${selector}&attempt_id=eq.${attempt}&state=eq.sending`,{method:"PATCH",body:JSON.stringify({state:"uncertain",updated_at:new Date().toISOString()})});}catch{/* Retain sending on journal failure. */}
  throw new OvokoError(409,"Nie potwierdzono utworzenia samochodu. Mogl powstac w Ovoko; sprawdz go przed kolejna proba. Nie tworzymy kolejnej kopii.");
 }
}
