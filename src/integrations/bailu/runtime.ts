import { getSqlite } from "@/lib/db";
import { getOutputDir } from "@/lib/paths";
import type { BailuServiceCredentials } from "./auth";
import { BailuCallbackDelivery } from "./callback";
import { ExistingComposeAdapter } from "./existing-compose-adapter";
import { BailuServiceLedger } from "./ledger";
import { BailuStudioService } from "./service";

export interface BailuServiceRuntime {
  credentials: BailuServiceCredentials;
  service: BailuStudioService;
}

export class BailuRuntimeConfigError extends Error {
  readonly code = "studio_service_not_configured";

  constructor() {
    super("studio_service_not_configured");
    this.name = "BailuRuntimeConfigError";
  }
}

let runtime: BailuServiceRuntime | null = null;

function readCredentials(): BailuServiceCredentials {
  const keyId = process.env.BAILU_STUDIO_HMAC_KEY_ID;
  const secret = process.env.BAILU_STUDIO_HMAC_SECRET;
  if (!keyId || !secret) throw new BailuRuntimeConfigError();
  return { keyId, secret };
}

export function getBailuServiceRuntime(): BailuServiceRuntime {
  if (runtime) return runtime;
  const credentials = readCredentials();
  const ledger = new BailuServiceLedger(getSqlite());
  const callback = new BailuCallbackDelivery(ledger, {
    credentials,
    callbackUrl: process.env.BAILU_STUDIO_CALLBACK_URL,
  });
  runtime = {
    credentials,
    service: new BailuStudioService({
      ledger,
      compose: new ExistingComposeAdapter(),
      callback,
      outputRoot: getOutputDir(),
    }),
  };
  return runtime;
}
