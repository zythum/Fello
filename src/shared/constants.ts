import type { Feature } from "./schema";

/** 所有可用的 feature 列表，也作为默认值 */
export const ALL_FEATURES: Feature[] = ["skills", "ask_user", "share_to_user"];

/** feature → i18n key 映射 */
export const FEATURE_I18N_KEYS: Record<Feature, string> = {
  skills: "constant.feature.skills",
  ask_user: "constant.feature.askUser",
  share_to_user: "constant.feature.shareToUser",
};
