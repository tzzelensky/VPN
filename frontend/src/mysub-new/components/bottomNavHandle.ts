export type BottomNavHandle = {
  setSwipeProgress: (index: number, dragPx: number, pageWidth: number) => void;
  snapToIndex: (index: number, animate: boolean) => void;
};
