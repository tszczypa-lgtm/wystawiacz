import { AccountShell } from "../account-shell";
import { OvokoPanel } from "./ovoko-panel";

export default function OvokoPage() {
  return <AccountShell active="/panel/ovoko"><OvokoPanel /></AccountShell>;
}
