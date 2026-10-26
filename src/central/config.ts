/** Supply only a verified, authenticated API deployment. No credentials belong in VITE_ variables. */
export const APPS_SCRIPT_URL = import.meta.env.VITE_RSF_CENTRAL_API_URL || "";
export const FETCH_TIMEOUT_MS = 15000;
export const IS_FIXTURE = import.meta.env.VITE_RSF_FIXTURE_MODE === 'true';
