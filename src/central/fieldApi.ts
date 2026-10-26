import { post, ApiError } from "./transport";
import type { Status, UserSession, WorkAction, WorkVisit } from "./types";
export const DEMO_MODE = false;
export async function login(
  username: string,
  password: string,
): Promise<UserSession> {
  const { session } = await post({ action: "login", username, password });
  if (
    !session ||
    typeof session.token !== "string" ||
    typeof session.userId !== "string" ||
    typeof session.name !== "string" ||
    !["executor", "gestor", "diretor"].includes(session.role)
  ) {
    throw new ApiError("Sessão inválida. Contate o responsável pelo portal.");
  }
  return session;
}
export async function logout(session: UserSession): Promise<void> {
  await post({ action: "logout", token: session.token });
}
export async function getVisits(session: UserSession): Promise<WorkVisit[]> {
  const data = await post({ action: "listVisits", token: session.token });
  if (!Array.isArray(data.visits)) throw new ApiError("Histórico inválido.");
  return data.visits;
}
export async function enterRoom(
  session: UserSession,
  roomMark: string,
): Promise<WorkVisit> {
  return (await post({ action: "enter", token: session.token, roomMark }))
    .visit;
}
export async function exitRoom(
  session: UserSession,
  visitId: string,
  action: WorkAction,
  finalStatus: Status,
): Promise<WorkVisit> {
  return (
    await post({
      action: "exit",
      token: session.token,
      visitId,
      workAction: action,
      finalStatus,
    })
  ).visit;
}
