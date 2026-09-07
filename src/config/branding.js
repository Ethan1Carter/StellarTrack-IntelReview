const appName = import.meta.env.VITE_APP_TITLE?.trim() || '星轨智评';
const institutionName = import.meta.env.VITE_INSTITUTION_NAME?.trim() || '高校五育综合评价平台';
const englishName = import.meta.env.VITE_BRAND_ENGLISH?.trim() || 'XINGGUI';
const mark = import.meta.env.VITE_BRAND_MARK?.trim() || appName.slice(0, 1);

export const branding = Object.freeze({
  appName,
  institutionName,
  englishName,
  mark
});
