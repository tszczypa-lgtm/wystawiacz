import { AccountShell } from "../../account-shell";
import { InventoryViews } from "../inventory-views";
import { OvokoInventoryPanel } from "./ovoko-inventory-panel";

export default function OvokoInventoryPage() {
  return <AccountShell active="/panel/inventory"><InventoryViews active="ovoko" /><OvokoInventoryPanel /></AccountShell>;
}
