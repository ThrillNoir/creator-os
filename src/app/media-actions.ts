"use server";

import { revalidatePath } from "next/cache";
import { getActiveCreator } from "@/lib/current-creator";
import { setCreatorMediaSource } from "@/lib/db";
import { validateCreatorMediaSource } from "@/lib/media-sources";

export async function saveCreatorMediaSourceAction(formData: FormData) {
  const creator = await getActiveCreator();
  const mediaSource = validateCreatorMediaSource(String(formData.get("mediaSource") ?? ""));
  setCreatorMediaSource(creator.id, mediaSource);
  revalidatePath("/");
  revalidatePath("/library");
  revalidatePath(`/creators/${creator.id}`);
}
