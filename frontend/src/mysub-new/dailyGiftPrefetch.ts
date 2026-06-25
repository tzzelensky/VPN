import { claimMySubDailyGift, type MySubDailyGiftDto, type MySubProfileDto } from "../api";

export type DailyGiftClaimResult = Awaited<ReturnType<typeof claimMySubDailyGift>>;

export const OPEN_ANIM_MS = 950;
export const OPEN_ANIM_GOLDEN_MS = 1950;

const imageCache = new Set<string>();

function preloadGiftBanner(url: string | null | undefined): void {
  const src = String(url ?? "").trim();
  if (!src || imageCache.has(src)) return;
  imageCache.add(src);
  const img = new Image();
  img.decoding = "async";
  img.src = src;
}

/** Только картинки — claim только по клику пользователя. */
export function prefetchDailyGiftImages(profile: MySubProfileDto, activeUserId?: number): void {
  preloadGiftBanner(profile.daily_gift?.banner_image_url);
  const uid =
    activeUserId && activeUserId > 0
      ? activeUserId
      : profile.subscriptions.find((s) => s.stats.subscription_active)?.id ?? profile.subscriptions[0]?.id;
  if (uid) {
    const sub = profile.subscriptions.find((s) => s.id === uid);
    preloadGiftBanner(sub?.daily_gift?.banner_image_url);
  }
}

export function prefetchDailyGiftBanner(gift?: MySubDailyGiftDto): void {
  preloadGiftBanner(gift?.banner_image_url);
}

export async function claimDailyGiftWithAnimation(
  initData: string,
  userId: number,
  opts?: { golden?: boolean },
): Promise<DailyGiftClaimResult> {
  const minOpenMs = opts?.golden ? OPEN_ANIM_GOLDEN_MS : OPEN_ANIM_MS;
  const [res] = await Promise.all([
    claimMySubDailyGift({ init_data: initData, user_id: userId }),
    new Promise<void>((resolve) => window.setTimeout(resolve, minOpenMs)),
  ]);
  return res;
}
