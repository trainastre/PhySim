import { clamp, bilinearSample } from '../utils/MathUtils.js';

/**
 * 2D Grid data structure storing scalar and vector physics fields for fluid simulation.
 * Uses contiguous Float32Arrays for cache-friendly memory access and high performance.
 */
export class FluidGrid {
  /**
   * @param {number} width - Number of cells horizontally.
   * @param {number} height - Number of cells vertically.
   * @param {number} [dx=1.0] - Physical spacing/size of each cell.
   */
  constructor(width, height, dx = 1.0) {
    if (!Number.isInteger(width) || width < 3) {
      throw new Error(`Invalid grid width: ${width}. Width must be an integer >= 3.`);
    }
    if (!Number.isInteger(height) || height < 3) {
      throw new Error(`Invalid grid height: ${height}. Height must be an integer >= 3.`);
    }

    this.width = width;
    this.height = height;
    this.dx = dx;
    this.size = width * height;

    // Vector velocity field
    this.u = new Float32Array(this.size);      // Horizontal velocity
    this.v = new Float32Array(this.size);      // Vertical velocity
    this.uPrev = new Float32Array(this.size);  // Previous / scratch u
    this.vPrev = new Float32Array(this.size);  // Previous / scratch v

    // Scalar fields
    this.density = new Float32Array(this.size);      // Density / smoke / dye
    this.densityPrev = new Float32Array(this.size);  // Previous / scratch density
    this.pressure = new Float32Array(this.size);     // Pressure field (p)
    this.divergence = new Float32Array(this.size);   // Divergence field (div u)

    // Obstacle mask: 1 = solid obstacle/wall, 0 = fluid
    this.solid = new Uint8Array(this.size);

    // Initialize perimeter boundary as solid walls by default
    this.initBoundaryWalls();
  }

  /**
   * Initializes the outer domain boundaries as solid walls.
   */
  initBoundaryWalls() {
    for (let x = 0; x < this.width; x++) {
      this.solid[this.index(x, 0)] = 1;
      this.solid[this.index(x, this.height - 1)] = 1;
    }
    for (let y = 0; y < this.height; y++) {
      this.solid[this.index(0, y)] = 1;
      this.solid[this.index(this.width - 1, y)] = 1;
    }
  }

  /**
   * Computes the 1D buffer index from 2D coordinates.
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {number} 1D index.
   */
  index(x, y) {
    return (x | 0) + (y | 0) * this.width;
  }

  /**
   * Checks if cell coordinates are strictly within grid bounds.
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {boolean}
   */
  isInBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Checks if cell is a solid obstacle or boundary wall.
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {boolean}
   */
  isSolid(x, y) {
    if (!this.isInBounds(x, y)) return true;
    return this.solid[this.index(x, y)] === 1;
  }

  /**
   * Sets or clears a solid obstacle at the given cell.
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @param {boolean} solid - True to make cell solid wall, false for fluid.
   */
  setSolid(x, y, solid) {
    if (!this.isInBounds(x, y)) return;
    const idx = this.index(x, y);
    this.solid[idx] = solid ? 1 : 0;
    if (solid) {
      this.u[idx] = 0;
      this.v[idx] = 0;
      this.uPrev[idx] = 0;
      this.vPrev[idx] = 0;
      this.density[idx] = 0;
      this.densityPrev[idx] = 0;
      this.pressure[idx] = 0;
      this.divergence[idx] = 0;
    }
  }

  /**
   * Sets rectangular box obstacle.
   * @param {number} startX - Left cell coordinate.
   * @param {number} startY - Top cell coordinate.
   * @param {number} w - Box width.
   * @param {number} h - Box height.
   * @param {boolean} [solid=true] - Solid state.
   */
  setSolidBox(startX, startY, w, h, solid = true) {
    for (let y = startY; y < startY + h; y++) {
      for (let x = startX; x < startX + w; x++) {
        this.setSolid(x, y, solid);
      }
    }
  }

  /**
   * Sets circular obstacle.
   * @param {number} cx - Center X coordinate.
   * @param {number} cy - Center Y coordinate.
   * @param {number} radius - Circle radius.
   * @param {boolean} [solid=true] - Solid state.
   */
  setSolidCircle(cx, cy, radius, solid = true) {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) {
          this.setSolid(x, y, solid);
        }
      }
    }
  }

  /**
   * Gets velocity vector at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {{ u: number, v: number }}
   */
  getVelocity(x, y) {
    if (!this.isInBounds(x, y)) return { u: 0, v: 0 };
    const idx = this.index(x, y);
    return { u: this.u[idx], v: this.v[idx] };
  }

  /**
   * Sets velocity vector at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @param {number} uVal - Horizontal velocity.
   * @param {number} vVal - Vertical velocity.
   */
  setVelocity(x, y, uVal, vVal) {
    if (!this.isInBounds(x, y) || this.isSolid(x, y)) return;
    const idx = this.index(x, y);
    this.u[idx] = uVal;
    this.v[idx] = vVal;
  }

  /**
   * Adds velocity increment to cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @param {number} du - Horizontal velocity delta.
   * @param {number} dv - Vertical velocity delta.
   */
  addVelocity(x, y, du, dv) {
    if (!this.isInBounds(x, y) || this.isSolid(x, y)) return;
    const idx = this.index(x, y);
    this.u[idx] += du;
    this.v[idx] += dv;
  }

  /**
   * Gets scalar density at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {number}
   */
  getDensity(x, y) {
    if (!this.isInBounds(x, y)) return 0;
    return this.density[this.index(x, y)];
  }

  /**
   * Sets scalar density at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @param {number} val - Density value.
   */
  setDensity(x, y, val) {
    if (!this.isInBounds(x, y) || this.isSolid(x, y)) return;
    this.density[this.index(x, y)] = Math.max(0, val);
  }

  /**
   * Adds scalar density at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @param {number} amount - Density amount to add.
   */
  addDensity(x, y, amount) {
    if (!this.isInBounds(x, y) || this.isSolid(x, y)) return;
    const idx = this.index(x, y);
    this.density[idx] = Math.max(0, this.density[idx] + amount);
  }

  /**
   * Gets pressure at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {number}
   */
  getPressure(x, y) {
    if (!this.isInBounds(x, y)) return 0;
    return this.pressure[this.index(x, y)];
  }

  /**
   * Sets pressure at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @param {number} val - Pressure value.
   */
  setPressure(x, y, val) {
    if (!this.isInBounds(x, y)) return;
    this.pressure[this.index(x, y)] = val;
  }

  /**
   * Gets divergence at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {number}
   */
  getDivergence(x, y) {
    if (!this.isInBounds(x, y)) return 0;
    return this.divergence[this.index(x, y)];
  }

  /**
   * Samples velocity at fractional position using bilinear interpolation.
   * @param {number} x - Continuous x coordinate.
   * @param {number} y - Continuous y coordinate.
   * @returns {{ u: number, v: number }}
   */
  sampleVelocity(x, y) {
    const u = bilinearSample(this.u, this.width, this.height, x, y);
    const v = bilinearSample(this.v, this.width, this.height, x, y);
    return { u, v };
  }

  /**
   * Samples density at fractional position using bilinear interpolation.
   * @param {number} x - Continuous x coordinate.
   * @param {number} y - Continuous y coordinate.
   * @returns {number}
   */
  sampleDensity(x, y) {
    return bilinearSample(this.density, this.width, this.height, x, y);
  }

  /**
   * Clears simulation fields.
   * @param {boolean} [clearSolids=false] - Whether to also clear solid obstacles.
   */
  reset(clearSolids = false) {
    this.u.fill(0);
    this.v.fill(0);
    this.uPrev.fill(0);
    this.vPrev.fill(0);
    this.density.fill(0);
    this.densityPrev.fill(0);
    this.pressure.fill(0);
    this.divergence.fill(0);

    if (clearSolids) {
      this.solid.fill(0);
      this.initBoundaryWalls();
    }
  }
}
