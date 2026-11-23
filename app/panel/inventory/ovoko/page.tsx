import { AccountShell } from "../../account-shell";
import { CombinedInventoryPanel } from "../combined-panel";

export default function OvokoInventoryPage() {
  return <AccountShell active="/panel/inventory"><CombinedInventoryPanel portal="ovoko" /></AccountShell>;
}
