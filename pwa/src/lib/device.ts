import { t } from './i18n';

/** What the browser tells about this device. `model` comes from User-Agent Client Hints. */
export interface DeviceHints {
  userAgent: string;
  maxTouchPoints: number;
  model?: string;
}

const clean = (model: string | undefined) => {
  const value = model?.trim() ?? '';
  // Reduced user agents report "K" in place of the model.
  return value && value !== 'K' ? value.slice(0, 40) : '';
};

/**
 * The most specific name the browser allows. iOS never exposes the model, so iPhone and iPad keep
 * their family name; Android names its model when Client Hints provide one.
 */
export function deviceName({ userAgent, maxTouchPoints, model }: DeviceHints): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPod/.test(userAgent)) return 'iPod touch';
  // iPadOS Safari presents itself as a Mac; only touch support tells them apart.
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(userAgent)) {
    // Older user agents still carry the model before "Build/".
    const legacy = /Android [^;)]*;\s*([^;)]+?)\s+Build\//.exec(userAgent)?.[1];
    return clean(model) || clean(legacy) || t(/Mobile/.test(userAgent) ? 'androidPhone' : 'androidTablet');
  }
  if (/Macintosh/.test(userAgent)) return 'Mac';
  if (/Windows/.test(userAgent)) return t('windowsComputer');
  return t('deviceDefault');
}

type ClientHints = { getHighEntropyValues(hints: string[]): Promise<{ model?: string }> };

/** Reads the Android model where the browser supports Client Hints; elsewhere the quick guess stands. */
export async function detectDeviceName(): Promise<string> {
  const hints: DeviceHints = { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
  const data = (navigator as Navigator & { userAgentData?: ClientHints }).userAgentData;
  if (data && /Android/.test(hints.userAgent)) {
    try {
      hints.model = (await data.getHighEntropyValues(['model'])).model;
    } catch {
      // A browser may refuse high-entropy hints; the family name is still useful.
    }
  }
  return deviceName(hints);
}
