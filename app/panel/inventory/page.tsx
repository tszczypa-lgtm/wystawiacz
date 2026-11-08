import { AccountShell } from "../account-shell";
import { InventoryPanel } from "./inventory-panel";

export default function InventoryPage() {
  return <AccountShell active="/panel/inventory"><InventoryPanel /></AccountShell>;
}
