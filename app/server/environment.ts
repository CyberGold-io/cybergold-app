import "server-only";
import { validatePublicEnvironment } from "../config/publicEnvironment.ts";
import { environmentConfig, environmentSetting } from "../config/environmentValidation.ts";

export const serverEnv = environmentConfig({
  CYBERGOLD_BACKEND_BEARER_TOKEN: environmentSetting("CYBERGOLD_BACKEND_BEARER_TOKEN", () => process.env.CYBERGOLD_BACKEND_BEARER_TOKEN, "text"),
  CYBERGOLD_BACKEND_URL: environmentSetting("CYBERGOLD_BACKEND_URL", () => process.env.CYBERGOLD_BACKEND_URL, "url"),
});

export function validateEnvironment() {
  validatePublicEnvironment();
  Object.values(serverEnv);
}
