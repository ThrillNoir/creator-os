import type { CreatorAccount } from "./domain";

export const thrillNoirPilot = {
  id: "thrill-noir",
  name: "Thrill Noir",
  mediaSource: "/Users/BR/Library/CloudStorage/Dropbox/1 THRILL NOIR/# PHOTOS OPTIMISED",
  mediaSourceMode: "read_only",
  contentPolicy: "Public platforms receive promotional content approved by a human.",
  accounts: [
    {
      id: "thrill-noir-instagram",
      creatorId: "thrill-noir",
      label: "Thrill Noir Instagram",
      platform: "instagram",
      handle: "@thrillnoir",
      url: "https://www.instagram.com/thrillnoir/",
      publishingMode: "finish_on_device",
      category: "public_promotion",
      connectionStatus: "not_connected",
    },
    {
      id: "thrill-noir-x",
      creatorId: "thrill-noir",
      label: "Thrill Noir X",
      platform: "x",
      handle: "@Thrillnoir",
      url: "https://x.com/Thrillnoir",
      publishingMode: "finish_on_device",
      category: "public_promotion",
      connectionStatus: "not_connected",
    },
    {
      id: "thrill-noir-tiktok",
      creatorId: "thrill-noir",
      label: "Thrill Noir TikTok",
      platform: "tiktok",
      handle: "@thrillnoir",
      url: "https://www.tiktok.com/@thrillnoir",
      publishingMode: "finish_on_device",
      category: "public_promotion",
      connectionStatus: "not_connected",
    },
    {
      id: "thrill-noir-reddit",
      creatorId: "thrill-noir",
      label: "Thrill Noir Reddit",
      platform: "reddit",
      handle: "u/ThrillNoirPhtogrphy",
      url: "https://www.reddit.com/user/ThrillNoirPhtogrphy/",
      publishingMode: "desktop_assisted",
      category: "public_promotion",
      connectionStatus: "not_connected",
    },
    {
      id: "thrill-noir-myroomz",
      creatorId: "thrill-noir",
      label: "Thrill Noir MyRoomz",
      platform: "myroomz",
      handle: "thrillnoir",
      url: "https://live.myroomz.co/profile/thrillnoir",
      publishingMode: "desktop_assisted",
      category: "paid_platform",
      connectionStatus: "not_connected",
    },
    {
      id: "thrill-noir-onlyfans",
      creatorId: "thrill-noir",
      label: "Thrill Noir OnlyFans",
      platform: "onlyfans",
      handle: "@thesaddesthugh",
      url: "https://onlyfans.com/thesaddesthugh",
      publishingMode: "desktop_assisted",
      category: "paid_platform",
      connectionStatus: "not_connected",
    },
    {
      id: "thrill-noir-youtube",
      creatorId: "thrill-noir",
      label: "Thrill Noir YouTube",
      platform: "youtube",
      handle: "@ThrillNoir",
      url: "https://www.youtube.com/@ThrillNoir",
      publishingMode: "finish_on_device",
      category: "public_promotion",
      connectionStatus: "not_connected",
    },
  ],
} as const satisfies {
  id: string;
  name: string;
  mediaSource: string;
  mediaSourceMode: "read_only";
  contentPolicy: string;
  accounts: ReadonlyArray<
    CreatorAccount & {
      url: string;
      category: "public_promotion" | "paid_platform";
      connectionStatus: "not_connected";
    }
  >;
};
