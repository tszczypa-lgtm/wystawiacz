import { AccountShell } from "../account-shell";
import { AdminPanel } from "./admin-panel";

export default function AdminPage() {
  return <AccountShell active="/panel/admin"><AdminPanel /></AccountShell>;
}
