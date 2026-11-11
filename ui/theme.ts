// OpenUI theme tokens mapped onto BB's own CSS variables, so blocks use BB's
// font, 13px text scale, colours and borders. BB's variables already flip with
// its light/dark theme, so one token set serves both modes.
import { useMemo } from "react";
import { createTheme, type Theme } from "@openuidev/react-ui";

const FONT = "var(--font-sans)";
const REGULAR = 400;
const HEAVY = 560;

/** OpenUI's compound font tokens ("400 16px/1.5 Inter") rebuilt at BB's sizes. */
function typeScale(): Record<string, string> {
  const tokens: Record<string, string> = {};
  const sized = (prefix: string, sizes: Record<string, number>, lineHeight: number, heavy: boolean) => {
    for (const [name, px] of Object.entries(sizes)) {
      tokens[`${prefix}${name}`] = `${REGULAR} ${px}px/${lineHeight} ${FONT}`;
      if (heavy) tokens[`${prefix}${name}Heavy`] = `${HEAVY} ${px}px/${lineHeight} ${FONT}`;
    }
  };
  const body = { Xs: 11, Sm: 12, Default: 13, Lg: 14 };
  sized("textBody", body, 1.6, true);
  sized("textLabel", body, 1.3, true);
  sized("textNumbers", body, 1.5, true);
  for (const [name, px] of Object.entries({ Xs: 13, Sm: 14, Md: 16, Lg: 18, Xl: 20 })) {
    tokens[`textHeading${name}`] = `600 ${px}px/1.3 ${FONT}`;
    tokens[`textNumbersHeading${name}`] = `600 ${px}px/1.3 ${FONT}`;
  }
  return tokens;
}

const accent = (percent: number) => `color-mix(in oklch, var(--primary) ${percent}%, transparent)`;
const tint = (color: string, percent: number) => `color-mix(in oklab, var(${color}) ${percent}%, transparent)`;

/**
 * OpenUI's washes and status colours on BB's: its neutral overlays become BB's ink, and its stock
 * Tailwind blue/green/yellow/red become BB's timeline accent, success, warning and destructive.
 * Text uses BB's readable variants (--success-foreground, --warning-text, --destructive-text);
 * --success / --warning are too light for text on white. *Inverted texts stay OpenUI's.
 */
const surfaces = {
  sunkLight: "var(--surface-raised)",
  sunk: "var(--surface-recessed)",
  sunkDeep: tint("--foreground", 10),
  elevatedLight: tint("--foreground", 4),
  elevated: tint("--foreground", 8),
  elevatedStrong: tint("--foreground", 16),
  elevatedIntense: tint("--foreground", 32),
  highlightSubtle: tint("--foreground", 2),
  highlight: "var(--state-hover)",
  highlightStrong: "var(--state-active)",
  highlightIntense: tint("--foreground", 30),
  invertedBackground: "var(--foreground)",
  textNeutralTertiary: tint("--muted-foreground", 55),
  textAccentSecondary: tint("--primary-foreground", 50),
  textAccentTertiary: tint("--primary-foreground", 20),
  borderInteractiveSelected: "var(--primary)",
  borderAccentEmphasis: "var(--surface-selected-border)",
};
const statuses = {
  infoBackground: tint("--timeline-accent", 12),
  textInfoPrimary: "var(--timeline-accent)",
  borderInfo: tint("--timeline-accent", 20),
  borderInfoEmphasis: "var(--timeline-accent)",
  successBackground: tint("--success", 12),
  textSuccessPrimary: "var(--success-foreground)",
  borderSuccess: tint("--success", 20),
  borderSuccessEmphasis: "var(--success)",
  alertBackground: tint("--warning", 12),
  textAlertPrimary: "var(--warning-text)",
  borderAlert: tint("--warning", 20),
  borderAlertEmphasis: "var(--warning)",
  dangerBackground: "var(--surface-destructive)",
  textDangerPrimary: "var(--destructive-text)",
  textDangerSecondary: tint("--destructive-text", 75),
  textDangerTertiary: tint("--destructive-text", 50),
  textDangerInvertedPrimary: "var(--destructive-foreground)",
  borderDanger: "var(--surface-destructive-border)",
  borderDangerEmphasis: "var(--destructive)",
  interactiveDestructiveDefault: tint("--destructive", 2),
  interactiveDestructiveHover: tint("--destructive", 8),
  interactiveDestructivePressed: tint("--destructive", 12),
  interactiveDestructiveDisabled: tint("--destructive", 2),
  interactiveDestructiveAccentDefault: "var(--destructive)",
  interactiveDestructiveAccentHover: tint("--destructive", 85),
  interactiveDestructiveAccentPressed: "var(--destructive)",
  interactiveDestructiveAccentDisabled: tint("--destructive", 40),
};

export const bbTheme = createTheme({
  background: "var(--background)",
  foreground: "var(--card)",
  popoverBackground: "var(--popover)",
  textNeutralPrimary: "var(--foreground)",
  textNeutralSecondary: "var(--muted-foreground)",
  textNeutralLink: "var(--primary)",
  textBrand: "var(--primary)",
  textAccentPrimary: "var(--primary-foreground)",
  interactiveAccentDefault: "var(--primary)",
  interactiveAccentHover: accent(85),
  interactiveAccentPressed: "var(--primary)",
  interactiveAccentDisabled: accent(40),
  borderDefault: "var(--border)",
  borderInteractive: "var(--input)",
  borderInteractiveEmphasis: "var(--ring)",
  borderAccent: accent(30),
  ...surfaces,
  ...statuses,
  fontBody: FONT,
  fontHeading: FONT,
  fontLabel: FONT,
  fontNumbers: FONT,
  // Tighter than OpenUI's chat spacing, closer to BB's density.
  spaceM: "10px",
  spaceL: "12px",
  spaceXl: "16px",
  ...typeScale(),
});

// BB's chart accent, as genui uses it: the timeline accent, else the primary colour.
const ACCENT = "var(--color-timeline-accent, var(--primary))";
const PALETTE_KEYS = [
  "defaultChartPalette", "barChartPalette", "lineChartPalette", "areaChartPalette",
  "pieChartPalette", "radarChartPalette", "radialChartPalette", "horizontalBarChartPalette",
] as const;

/**
 * An 11-step ramp of BB's accent, dark to light like OpenUI's own palettes
 * (one series takes the middle step; heatmaps read it low to high).
 * Resolved to concrete colours because charts put them in SVG attributes, where var() doesn't work.
 */
export function chartRamp(resolve: (css: string) => string): string[] {
  return Array.from({ length: 11 }, (_, i) => {
    const t = (i - 5) / 5;
    if (t === 0) return resolve(ACCENT);
    const [other, amount] = t < 0 ? ["black", -t * 60] : ["white", t * 70];
    return resolve(`color-mix(in oklch, ${ACCENT} ${Math.round(100 - amount)}%, ${other})`);
  });
}

function resolveColor(css: string): string {
  const probe = document.createElement("span");
  probe.style.color = css;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** bbTheme plus chart palettes read from BB's current colours; recomputed when BB's mode flips. */
export function useBbTheme(dark: boolean): Theme {
  return useMemo(() => {
    void dark; // BB's variables change with the mode, so re-resolve on each flip.
    const ramp = chartRamp(resolveColor);
    return { ...bbTheme, ...Object.fromEntries(PALETTE_KEYS.map((key) => [key, ramp])) };
  }, [dark]);
}
