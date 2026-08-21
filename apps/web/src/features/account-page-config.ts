import type { AccountKind } from "@douyin-admin/shared";

type AccountPageConfig = {
  route: string;
  navLabel: string;
  title: string;
  createLabel: string;
  exportFileName: string;
  showEmail: boolean;
};

export const ACCOUNT_PAGE_CONFIG = {
  google: {
    route: "/accounts/google",
    navLabel: "抖音谷歌账号",
    title: "抖音谷歌账号管理",
    createLabel: "新增谷歌账号",
    exportFileName: "douyin-google-accounts.xlsx",
    showEmail: false
  },
  email: {
    route: "/accounts/email",
    navLabel: "抖音邮箱号",
    title: "抖音邮箱号管理",
    createLabel: "新增邮箱号",
    exportFileName: "douyin-email-accounts.xlsx",
    showEmail: true
  }
} satisfies Record<AccountKind, AccountPageConfig>;
