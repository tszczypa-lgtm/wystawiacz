import handler from "vinext/server/fetch-handler";
import { handleAllegroApi } from "../lib/allegro-api";
import { handleWorkspaceApi } from "../lib/workspace-api";
import { handleAccountApi, protectAllegroRequest, type AccountEnv } from "../lib/account-api";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    if (new URL(request.url).pathname.startsWith("/api/workspace/")) return handleWorkspaceApi(request, env as AccountEnv);
    if (new URL(request.url).pathname.startsWith("/api/account/")) return handleAccountApi(request, env as AccountEnv);
    if (new URL(request.url).pathname.startsWith("/api/allegro/")) {
      return protectAllegroRequest(request, env as AccountEnv, () => handleAllegroApi(request, env as Cloudflare.Env & Parameters<typeof handleAllegroApi>[1]));
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    const secured = new Response(response.body, response);
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("X-Frame-Options", "SAMEORIGIN");
    secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    secured.headers.set("Content-Security-Policy", "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
    return secured;
  },
};
