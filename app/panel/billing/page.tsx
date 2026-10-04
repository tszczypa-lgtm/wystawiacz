import { AccountShell } from "../account-shell";
import { BillingPanel } from "./billing-panel";

export default function BillingPage() {
  return <AccountShell active="/panel/billing"><BillingPanel /></AccountShell>;
}
