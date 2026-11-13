export interface BuildIdentity { commit: string; dirty: boolean }
declare const __TANDEM_LOCAL_BUILD__: BuildIdentity | null;

export const localBuildIdentity = typeof __TANDEM_LOCAL_BUILD__ === 'undefined' ? null : __TANDEM_LOCAL_BUILD__;

/** Official builds keep their release version; local builds expose their checkout identity. */
export function buildLabel(version: string, local: BuildIdentity | null = localBuildIdentity): string {
  return local ? local.commit.slice(0, 8) + (local.dirty ? '-dirty' : '') : version;
}
