const placeholderPattern = /(?:YOUR_PROJECT|replace-with|sb_(?:publishable|secret)_x{2,}|^xxx(?:\.|$))/i;

export function isConfiguredValue(value: string | undefined) {
  if (!value?.trim()) return false;
  return !placeholderPattern.test(value.trim());
}

export function isConfiguredSupabaseUrl(value: string | undefined) {
  if (!isConfiguredValue(value)) return false;
  try {
    const url = new URL(value!);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isSupabaseBrowserConfigured(url: string | undefined, key: string | undefined) {
  return isConfiguredSupabaseUrl(url) && isConfiguredValue(key);
}

export function isSupabaseServerConfigured(url: string | undefined, key: string | undefined) {
  return isConfiguredSupabaseUrl(url) && isConfiguredValue(key);
}
