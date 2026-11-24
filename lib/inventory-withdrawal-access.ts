import { accountContext, accountAccess, type AccountEnv } from "./account-api";
// Keep the dynamic route entry server-only; importing account-api dynamically
// resolves to an entry chunk without those named exports in the production build.
export async function inventoryWithdrawalAccess(request: Request, env: AccountEnv, owner: string) {
  const permission = await accountContext(request, env);
  return permission.user.id === owner && accountAccess(permission.account, env.BILLING_ENFORCED === "true", permission.isAdmin).allowed;
}
