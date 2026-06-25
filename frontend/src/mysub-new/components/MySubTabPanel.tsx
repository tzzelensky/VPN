import { memo } from "react";
import type { MySubNavTabId } from "../../components/MySubBottomNav";
import type { MySubWebAppController } from "../types";
import HomeTabNew from "../tabs/HomeTabNew";
import PayTabNew from "../tabs/PayTabNew";
import FriendsTabNew from "../tabs/FriendsTabNew";
import ProfileTabNew from "../tabs/ProfileTabNew";
import GameTabNew from "../tabs/GameTabNew";

type Props = {
  id: MySubNavTabId;
  ctrl: MySubWebAppController;
};

function MySubTabPanel({ id, ctrl }: Props) {
  let content = null as React.ReactNode;
  if (id === "home") content = <HomeTabNew ctrl={ctrl} />;
  else if (id === "subscription") content = <PayTabNew ctrl={ctrl} />;
  else if (id === "friends") content = <FriendsTabNew ctrl={ctrl} />;
  else if (id === "profile") content = <ProfileTabNew ctrl={ctrl} />;
  else if (id === "game") content = <GameTabNew ctrl={ctrl} />;

  return <div className="mn-tab-stack">{content}</div>;
}

export default memo(MySubTabPanel);
