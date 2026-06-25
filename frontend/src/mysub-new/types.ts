import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from "react";
import type { MySubNavTabId } from "../components/MySubBottomNav";
import type { MySubProfileDto } from "../api";

export type MySubTheme = "dark" | "light";
export type MySubTab = MySubNavTabId;
export type PayProduct = "subscription" | "topup" | "white_lists" | "device_slot";

export type MySubWebAppController = {
  data: MySubProfileDto;
  err: string;
  msg: string;
  setMsg: (msg: string) => void;
  tab: MySubTab;
  setTab: (tab: MySubTab) => void;
  theme: MySubTheme;
  applyMySubTheme: (theme: MySubTheme) => void;
  initData: string;
  setData: Dispatch<SetStateAction<MySubProfileDto | null>>;

  homeSub: MySubProfileDto["subscriptions"][number] | null;
  homeSubId: number;
  setHomeSubId: (id: number) => void;
  pickedSubId: number;
  setPickedSubId: (id: number) => void;
  profileSub: MySubProfileDto["subscriptions"][number] | undefined;
  hasActiveSubscription: boolean;

  showInstruction: boolean;
  setShowInstruction: (v: boolean) => void;
  showWhitelistInstruction: boolean;
  setShowWhitelistInstruction: (v: boolean) => void;
  showPickModal: boolean;
  setShowPickModal: (v: boolean) => void;

  payProduct: PayProduct;
  switchPayProduct: (next: PayProduct) => void;
  payPlanId: number;
  setPayPlanId: (id: number) => void;
  payIsTest: boolean;
  setPayIsTest: (v: boolean) => void;
  payPhoto: File | null;
  setPayPhoto: (f: File | null) => void;
  busyPay: boolean;
  payTargetId: number;
  setPayTargetId: (id: number) => void;
  payTargetSub: MySubProfileDto["subscriptions"][number] | null;
  newSubName: string;
  setNewSubName: (name: string) => void;
  suggestedNewSubName: string;
  selectedPlan: MySubProfileDto["plans"][number] | null;
  selectedTopUpPlan: MySubProfileDto["topup_plans"][number] | null;
  testPlanAvailable: boolean;
  salesDisabledForNew: boolean;
  submitPaymentProof: () => Promise<void>;
  openTestPay: () => void;

  promoCodeInput: string;
  setPromoCodeInput: (v: string) => void;
  promoApplied: { code: string; discount_percent: number } | null;
  promoFeedback: { type: "ok" | "err"; text: string } | null;
  applyPromoCode: () => Promise<void>;
  activeDiscountPercent: number;
  autoDiscountPercent: number;
  discountedPriceForPlan: (priceRub: number) => number;

  copySubscription: (url: string) => Promise<void>;
  openPickForCopy: () => void;

  busyDevicePay: boolean;
  deviceSlotFileRef: MutableRefObject<HTMLInputElement | null>;
  submitDeviceSlotPayment: (file: File, subId: number) => Promise<void>;
  openDeviceSlotPay: (subId: number) => void;
  refreshProfile: () => Promise<void>;

  shareReferralInTelegram: () => void;
  friendRewardId: string;
  setFriendRewardId: (id: string) => void;
  friendRewardBusy: boolean;
  claimFriendReward: (kind: "gb" | "days") => Promise<void>;

  supportOpen: boolean;
  setSupportOpen: (v: boolean) => void;
  supportText: string;
  setSupportText: (v: string) => void;
  supportPhotos: File[];
  setSupportPhotos: Dispatch<SetStateAction<File[]>>;
  supportBusy: boolean;
  openSupportProfile: () => void;
  submitSupportAppeal: () => Promise<void>;

  profileSubModalId: number;
  setProfileSubModalId: (id: number) => void;

  gameVisible: boolean;
  activeGame: "none" | "dropper" | "roulette";
  gameTickets: number;
  dropperPlaying: boolean;
  isGameTab: boolean;
  dropperTargetUserId: number;
  dropperSession: { sessionId: string; seed: number; practice?: boolean } | null;
  dropperInstructionOpen: boolean;
  setDropperInstructionOpen: (v: boolean) => void;
  dropperPracticeModalOpen: boolean;
  setDropperPracticeModalOpen: (v: boolean) => void;
  dropperPracticeSkipNextHint: boolean;
  setDropperPracticeSkipNextHint: (v: boolean) => void;
  dropperNoTickets: boolean;
  dropperStartBusy: boolean;
  startDropperPlay: () => Promise<void>;
  openDropperPracticeIntro: () => void;
  confirmDropperPracticePlay: () => void;
  finishDropperAndRefresh: () => Promise<void>;

  bottomNavItems: Array<{
    id: MySubNavTabId;
    label: string;
    icon: ReactNode;
    gameTickets?: number;
    gameEnabled?: boolean;
  }>;
};
