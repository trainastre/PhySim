import { clamp, bilinearSample } from '../utils/MathUtils.js';

/**
 * Performs semi-Lagrangian advection of scalar and vector fields.
 * Unconditionally stable for arbitrary time steps and velocity magnitudes.
 */
export class Advection {
  /**
   * Advects field `src` along velocity fields (u, v) into `dest`.
   * 
   * @param {Float32Array} dest - Target buffer for advected values.
   * @param {Float32Array} src - Source buffer containing current values.
   * @param {Float32Array} u - Horizontal velocity field.
   * @param {Float32Array} v - Vertical velocity field.
   * @param {Uint8Array} solid - Obstacle mask.
   * @param {number} width - Grid width.
   * @param {number} height - Grid height.
   * @param {number} dt - Time step.
   * @param {number} dx - Cell size.
   */
  static advect(dest, src, u, v, solid, width, height, dt, dx) {
    const dt0 = dt / dx;

    // Interior domain bounds (inside solid borders)
    const minX = 0.5;
    const maxX = width - 1.5;
    const minY = 0.5;
    const maxY = height - 1.5;

    for (let y = 1; y < height - 1; y++) {
      const rowOffset = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = rowOffset + x;

        // Do not advect into solid cells
        if (solid[idx] === 1) {
          dest[idx] = 0;
          continue;
        }

        // Velocity at current cell
        const cellU = u[idx];
        const cellV = v[idx];

        // Trace back in time along streamline
        const backX = clamp(x - dt0 * cellU, minX, maxX);
        const backY = clamp(y - dt0 * cellV, minY, maxY);

        // Interpolate value from traced position
        dest[idx] = bilinearSample(src, width, height, backX, backY);
      }
    }
  }
}
