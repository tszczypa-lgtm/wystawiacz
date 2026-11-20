import { AccountShell } from "../account-shell";
import { InventoryPanel } from "./inventory-panel";
import { InventoryViews } from "./inventory-views";

export default function InventoryPage() {
  return <AccountShell active="/panel/inventory"><InventoryViews active="allegro" /><InventoryPanel /></AccountShell>;
}
