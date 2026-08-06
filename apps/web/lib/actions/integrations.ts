"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, requireAuth } from "@/lib/session";
import { createFeedToken, getFeedToken } from "@/lib/services/integrations";
import { toErrorState, type ServerErrorShape } from "@/lib/errors";

export interface FeedTokenState extends ServerErrorShape {
  url?: string;
}

function feedUrl(userId: string, token: string): string {
  return `/api/ical/${userId}?token=${token}`;
}

/** Returns the current private feed URL for the signed-in user. */
export async function getCalendarFeedUrl(): Promise<FeedTokenState> {
  const user = await requireAuth();
  try {
    const token = await getFeedToken(user);
    return { url: feedUrl(user.id, token) };
  } catch (error) {
    return toErrorState(error);
  }
}

/** Rotates the token and returns the new feed URL. */
export async function regenerateCalendarFeedAction(): Promise<FeedTokenState> {
  const user = await getCurrentUser();
  if (!user) return { errorCode: "notSignedIn" };
  try {
    const token = await createFeedToken(user);
    revalidatePath("/calendar");
    return { url: feedUrl(user.id, token) };
  } catch (error) {
    return toErrorState(error);
  }
}
