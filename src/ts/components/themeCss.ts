export function normalizeThemeKey(key: string): string {
  if (key.startsWith("--")) {
    return key;
  }
  if (key.startsWith("dv-")) {
    return `--${key}`;
  }
  return `--dv-${key}`;
}

export function buildThemeCss(
  id: string,
  overrides: Record<string, string> | null | undefined,
): string | null {
  const entries = Object.entries(overrides ?? {});
  if (entries.length === 0) {
    return null;
  }
  const declarations = entries
    .map(([key, value]) => `${normalizeThemeKey(key)}: ${value};`)
    .join(" ");
  return `#${id} .dv-dockview { ${declarations} }`;
}
