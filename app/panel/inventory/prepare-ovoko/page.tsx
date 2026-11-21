import { AccountShell } from "../../account-shell";
import { InventoryViews } from "../inventory-views";
import { OvokoPreparationPanel } from "./preparation-panel";

export default function OvokoPreparationPage() {
  return <AccountShell active="/panel/inventory"><InventoryViews active="allegro" /><OvokoPreparationPanel /></AccountShell>;
}
