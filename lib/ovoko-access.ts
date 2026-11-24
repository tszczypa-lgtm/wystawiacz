import { accountAccess, type accountContext, type AccountEnv } from "./account-api";
import { OvokoError } from "./ovoko-read";
export function requireOvokoAccess(context: Awaited<ReturnType<typeof accountContext>>, env: AccountEnv) {
  const access = accountAccess(context.account, env.BILLING_ENFORCED === "true", context.isAdmin);
  if (!access.allowed) throw new OvokoError(403, access.reason);
}
