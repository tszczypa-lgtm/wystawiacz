import { AccountShell } from "../account-shell";
import { CombinedInventoryPanel } from "./combined-panel";

export default function InventoryPage() {
  return <AccountShell active="/panel/inventory"><CombinedInventoryPanel /></AccountShell>;
}
