import { APPS_SCRIPT_URL, FETCH_TIMEOUT_MS } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

/** Tokens stay in request bodies; never put them in URLs or logs. No automatic write retries. */
export async function post(
  payload: Record<string, unknown>,
): Promise<Record<string, any>> {
  if (!APPS_SCRIPT_URL)
    throw new ApiError(
      "A conexão segura ainda não foi configurada.",
      "CONFIG_REQUIRED",
    );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: new URLSearchParams({ payload: JSON.stringify(payload) }),
      signal: controller.signal,
      redirect: "follow",
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok)
      throw new ApiError(
        `Servidor indisponível (${response.status}). Tente novamente.`,
      );
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        "Resposta inválida do servidor. Nenhum resultado foi confirmado.",
      );
    }
    if (!data || typeof data !== "object" || data.ok !== true) {
      throw new ApiError(
        data?.erro || "Não foi possível concluir a operação.",
        data?.code || "REQUEST_FAILED",
      );
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === "AbortError")
      throw new ApiError(
        "O servidor demorou a responder. Atualize os dados antes de repetir um registro.",
        "TIMEOUT",
      );
    throw new ApiError(
      "Sem conexão com o servidor. Atualize os dados antes de repetir um registro.",
      "NETWORK",
    );
  } finally {
    clearTimeout(timer);
  }
}
