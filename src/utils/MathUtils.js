/**
 * Mathematical utility functions for fluid dynamics computations.
 */

/**
 * Clamps a numerical value to the specified range [min, max].
 * @param {number} value - The input value.
 * @param {number} min - The lower bound.
 * @param {number} max - The upper bound.
 * @returns {number} Clamped value.
 */
export function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Linear interpolation between two values.
 * @param {number} a - Start value.
 * @param {number} b - End value.
 * @param {number} t - Interpolation factor in [0, 1].
 * @returns {number} Interpolated value.
 */
export function lerp(a, b, t) {
  return a + t * (b - a);
}

/**
 * Bilinear sampling from a 1D-flattened 2D grid array.
 * Performs boundary-safe interpolation at floating point coordinates (x, y).
 * 
 * @param {Float32Array|Float64Array|Array<number>} field - 1D array of size width * height.
 * @param {number} width - Grid width in cells.
 * @param {number} height - Grid height in cells.
 * @param {number} x - Sampling x-coordinate (in cell units).
 * @param {number} y - Sampling y-coordinate (in cell units).
 * @returns {number} Interpolated value at (x, y).
 */
export function bilinearSample(field, width, height, x, y) {
  // Clamp coordinates within domain
  const clampedX = clamp(x, 0, width - 1);
  const clampedY = clamp(y, 0, height - 1);

  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  const tx = clampedX - x0;
  const ty = clampedY - y0;

  const row0 = y0 * width;
  const row1 = y1 * width;

  const v00 = field[row0 + x0];
  const v10 = field[row0 + x1];
  const v01 = field[row1 + x0];
  const v11 = field[row1 + x1];

  const top = v00 + tx * (v10 - v00);
  const bottom = v01 + tx * (v11 - v01);

  return top + ty * (bottom - top);
}
