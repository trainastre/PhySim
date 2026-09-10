import { clamp, lerp } from '../utils/MathUtils.js';

/**
 * Supported color palettes for fluid visualization.
 */
export const ColorPalette = Object.freeze({
  FIRE: 'fire',
  OCEAN: 'ocean',
  TURBO: 'turbo',
  INFERNO: 'inferno',
  GREYSCALE: 'greyscale',
  NEON: 'neon',
});

/**
 * Color stop definitions for fluid colormaps.
 * Stops are normalized from t = 0.0 to 1.0 with RGB triplets [0-255].
 */
const PALETTE_DEFINITIONS = {
  [ColorPalette.FIRE]: [
    { t: 0.00, rgb: [10, 8, 14] },
    { t: 0.15, rgb: [95, 12, 10] },
    { t: 0.35, rgb: [210, 45, 8] },
    { t: 0.60, rgb: [255, 140, 15] },
    { t: 0.85, rgb: [255, 230, 60] },
    { t: 1.00, rgb: [255, 255, 240] },
  ],
  [ColorPalette.OCEAN]: [
    { t: 0.00, rgb: [4, 10, 26] },
    { t: 0.20, rgb: [12, 50, 110] },
    { t: 0.45, rgb: [0, 130, 195] },
    { t: 0.70, rgb: [0, 210, 220] },
    { t: 0.88, rgb: [140, 245, 255] },
    { t: 1.00, rgb: [245, 255, 255] },
  ],
  [ColorPalette.TURBO]: [
    { t: 0.00, rgb: [48, 18, 59] },
    { t: 0.20, rgb: [68, 120, 225] },
    { t: 0.40, rgb: [35, 200, 130] },
    { t: 0.60, rgb: [210, 215, 35] },
    { t: 0.80, rgb: [245, 100, 25] },
    { t: 1.00, rgb: [190, 40, 40] },
  ],
  [ColorPalette.INFERNO]: [
    { t: 0.00, rgb: [0, 0, 4] },
    { t: 0.20, rgb: [65, 12, 85] },
    { t: 0.45, rgb: [165, 45, 90] },
    { t: 0.70, rgb: [230, 105, 30] },
    { t: 0.90, rgb: [250, 205, 55] },
    { t: 1.00, rgb: [252, 255, 180] },
  ],
  [ColorPalette.GREYSCALE]: [
    { t: 0.00, rgb: [12, 12, 16] },
    { t: 0.25, rgb: [70, 72, 80] },
    { t: 0.50, rgb: [130, 135, 145] },
    { t: 0.75, rgb: [195, 200, 210] },
    { t: 1.00, rgb: [250, 250, 255] },
  ],
  [ColorPalette.NEON]: [
    { t: 0.00, rgb: [12, 4, 30] },
    { t: 0.30, rgb: [120, 0, 160] },
    { t: 0.60, rgb: [225, 20, 190] },
    { t: 0.85, rgb: [0, 215, 255] },
    { t: 1.00, rgb: [235, 255, 255] },
  ],
};

/**
 * Builds a precomputed 256-entry RGBA Lookup Table (LUT).
 * @param {Array<{t: number, rgb: number[]}>} stops
 * @returns {Uint8ClampedArray} 1024 bytes (256 * 4) RGBA array
 */
function buildLookupTable(stops) {
  const lut = new Uint8ClampedArray(256 * 4);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r = 0;
    let g = 0;
    let b = 0;

    if (t <= stops[0].t) {
      [r, g, b] = stops[0].rgb;
    } else if (t >= stops[stops.length - 1].t) {
      [r, g, b] = stops[stops.length - 1].rgb;
    } else {
      for (let s = 0; s < stops.length - 1; s++) {
        const s0 = stops[s];
        const s1 = stops[s + 1];
        if (t >= s0.t && t <= s1.t) {
          const factor = (t - s0.t) / (s1.t - s0.t);
          r = Math.round(lerp(s0.rgb[0], s1.rgb[0], factor));
          g = Math.round(lerp(s0.rgb[1], s1.rgb[1], factor));
          b = Math.round(lerp(s0.rgb[2], s1.rgb[2], factor));
          break;
        }
      }
    }

    const idx = i * 4;
    lut[idx] = r;
    lut[idx + 1] = g;
    lut[idx + 2] = b;
    lut[idx + 3] = 255; // Fully opaque
  }

  return lut;
}

// Precompute LUTs for fast O(1) sampling per cell
const COLOR_LUTS = {};
for (const [key, stops] of Object.entries(PALETTE_DEFINITIONS)) {
  COLOR_LUTS[key] = buildLookupTable(stops);
}

/**
 * Retrieves the precomputed 256x4 RGBA lookup table for a given palette.
 * @param {string} palette - One of ColorPalette values.
 * @returns {Uint8ClampedArray}
 */
export function getPaletteLUT(palette = ColorPalette.FIRE) {
  return COLOR_LUTS[palette] || COLOR_LUTS[ColorPalette.FIRE];
}

/**
 * Samples RGBA color for a normalized value t in [0.0, 1.0].
 * @param {string} palette - Color palette name.
 * @param {number} t - Normalized value between 0.0 and 1.0.
 * @returns {[number, number, number, number]} [r, g, b, a]
 */
export function sampleColorMap(palette, t) {
  const lut = getPaletteLUT(palette);
  const index = Math.min(255, Math.max(0, (clamp(t, 0.0, 1.0) * 255) | 0)) * 4;
  return [lut[index], lut[index + 1], lut[index + 2], lut[index + 3]];
}

/**
 * Converts HSV (Hue in [0, 1), Saturation in [0, 1], Value/Brightness in [0, 1]) to RGB.
 * Useful for 360-degree flow direction color wheel representation.
 * 
 * @param {number} h - Hue [0, 1)
 * @param {number} s - Saturation [0, 1]
 * @param {number} v - Value [0, 1]
 * @returns {[number, number, number]} [r, g, b] in [0, 255]
 */
export function hsvToRgb(h, s, v) {
  const normH = (h % 1 + 1) % 1; // Wrap into [0, 1)
  const i = Math.floor(normH * 6);
  const f = normH * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r = 0;
  let g = 0;
  let b = 0;

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
  ];
}
