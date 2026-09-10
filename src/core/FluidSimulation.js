import { FluidGrid } from './FluidGrid.js';
import { FluidSolver } from './FluidSolver.js';
import { BoundaryType } from './BoundaryConditions.js';

/**
 * Main Fluid Simulation Engine.
 * Operates completely headlessly, decoupled from any rendering or UI framework.
 * 
 * Manages grid state, physics solver, boundary constraints, and user/environmental interactions.
 */
export class FluidSimulation {
  /**
   * @param {Object} options - Simulation configuration.
   * @param {number} [options.width=64] - Grid width in cells.
   * @param {number} [options.height=64] - Grid height in cells.
   * @param {number} [options.cellSize=1.0] - Cell size (dx).
   * @param {number} [options.viscosity=0.0001] - Kinematic viscosity.
   * @param {number} [options.diffusion=0.00001] - Density diffusion rate.
   * @param {number} [options.solverIterations=25] - Relaxation iterations for Poisson solver.
   * @param {string} [options.boundaryType=BoundaryType.FREE_SLIP] - Boundary condition mode.
   * @param {number} [options.gravityX=0.0] - External gravity in X direction.
   * @param {number} [options.gravityY=0.0] - External gravity in Y direction.
   * @param {number} [options.vorticityStrength=0.0] - Optional vorticity enhancement factor.
   */
  constructor(options = {}) {
    const width = options.width ?? 64;
    const height = options.height ?? 64;
    const cellSize = options.cellSize ?? 1.0;

    this.grid = new FluidGrid(width, height, cellSize);
    this.solver = new FluidSolver(this.grid, {
      viscosity: options.viscosity ?? 0.0001,
      diffusion: options.diffusion ?? 0.00001,
      iterations: options.solverIterations ?? 25,
      boundaryType: options.boundaryType ?? BoundaryType.FREE_SLIP,
      gravityX: options.gravityX ?? 0.0,
      gravityY: options.gravityY ?? 0.0,
      vorticityStrength: options.vorticityStrength ?? 0.0,
    });

    this.time = 0.0;
    this.stepCount = 0;
  }

  /**
   * Advances the simulation by dt seconds.
   * @param {number} [dt=0.016] - Delta time.
   */
  step(dt = 0.016) {
    this.solver.step(dt);
    this.time += dt;
    this.stepCount++;
  }

  /**
   * Adds an injection of density at continuous coordinate (cx, cy) within a given radius.
   * Uses smooth radial falloff.
   * 
   * @param {number} cx - Center X coordinate in cells.
   * @param {number} cy - Center Y coordinate in cells.
   * @param {number} radius - Radius of injection in cells.
   * @param {number} amount - Total density peak amount.
   */
  addDensitySplat(cx, cy, radius, amount) {
    const r2 = radius * radius;
    const minX = Math.max(1, Math.floor(cx - radius));
    const maxX = Math.min(this.grid.width - 2, Math.ceil(cx + radius));
    const minY = Math.max(1, Math.floor(cy - radius));
    const maxY = Math.min(this.grid.height - 2, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dist2 = dx * dx + dy * dy;
        if (dist2 <= r2) {
          const falloff = 1.0 - Math.sqrt(dist2) / radius;
          this.grid.addDensity(x, y, amount * falloff);
        }
      }
    }
  }

  /**
   * Adds a directional velocity impulse within a radial area.
   * 
   * @param {number} cx - Center X coordinate.
   * @param {number} cy - Center Y coordinate.
   * @param {number} radius - Radius of impulse.
   * @param {number} u - Horizontal velocity.
   * @param {number} v - Vertical velocity.
   */
  addVelocityImpulse(cx, cy, radius, u, v) {
    const r2 = radius * radius;
    const minX = Math.max(1, Math.floor(cx - radius));
    const maxX = Math.min(this.grid.width - 2, Math.ceil(cx + radius));
    const minY = Math.max(1, Math.floor(cy - radius));
    const maxY = Math.min(this.grid.height - 2, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dist2 = dx * dx + dy * dy;
        if (dist2 <= r2) {
          const falloff = 1.0 - Math.sqrt(dist2) / radius;
          this.grid.addVelocity(x, y, u * falloff, v * falloff);
        }
      }
    }
  }

  /**
   * Sets a solid obstacle at specific cell.
   * @param {number} x - Cell x.
   * @param {number} y - Cell y.
   * @param {boolean} isSolid - Solid status.
   */
  setObstacle(x, y, isSolid) {
    this.grid.setSolid(x, y, isSolid);
  }

  /**
   * Adds a rectangular solid obstacle box.
   * @param {number} x - Start cell x.
   * @param {number} y - Start cell y.
   * @param {number} w - Width in cells.
   * @param {number} h - Height in cells.
   * @param {boolean} [isSolid=true] - Solid status.
   */
  setObstacleBox(x, y, w, h, isSolid = true) {
    this.grid.setSolidBox(x, y, w, h, isSolid);
  }

  /**
   * Adds a circular solid obstacle.
   * @param {number} cx - Center X.
   * @param {number} cy - Center Y.
   * @param {number} radius - Radius in cells.
   * @param {boolean} [isSolid=true] - Solid status.
   */
  setObstacleCircle(cx, cy, radius, isSolid = true) {
    this.grid.setSolidCircle(cx, cy, radius, isSolid);
  }

  /**
   * Resets the simulation state.
   * @param {boolean} [clearObstacles=false] - Whether to remove custom solid obstacles.
   */
  reset(clearObstacles = false) {
    this.grid.reset(clearObstacles);
    this.time = 0;
    this.stepCount = 0;
  }

  // --- Field Readout APIs (Independent of rendering) ---

  /**
   * Returns grid dimensions and cell sizing.
   */
  getDimensions() {
    return {
      width: this.grid.width,
      height: this.grid.height,
      cellSize: this.grid.dx,
      totalCells: this.grid.size,
    };
  }

  /**
   * Returns direct reference to scalar density Float32Array buffer.
   */
  getDensityBuffer() {
    return this.grid.density;
  }

  /**
   * Returns direct references to velocity Float32Array buffers.
   */
  getVelocityBuffers() {
    return {
      u: this.grid.u,
      v: this.grid.v,
    };
  }

  /**
   * Returns direct reference to pressure Float32Array buffer.
   */
  getPressureBuffer() {
    return this.grid.pressure;
  }

  /**
   * Returns direct reference to divergence Float32Array buffer.
   */
  getDivergenceBuffer() {
    return this.grid.divergence;
  }

  /**
   * Returns direct reference to solid obstacle mask Uint8Array buffer.
   */
  getObstacleBuffer() {
    return this.grid.solid;
  }

  /**
   * Samples density at arbitrary continuous coordinates.
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {number}
   */
  sampleDensity(x, y) {
    return this.grid.sampleDensity(x, y);
  }

  /**
   * Samples velocity at arbitrary continuous coordinates.
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @returns {{ u: number, v: number }}
   */
  sampleVelocity(x, y) {
    return this.grid.sampleVelocity(x, y);
  }

  /**
   * Returns physical diagnostic statistics.
   */
  getDiagnostics() {
    return {
      time: this.time,
      stepCount: this.stepCount,
      totalDensity: this.solver.getTotalDensity(),
      maxSpeed: this.solver.getMaxSpeed(),
      maxDivergence: this.solver.getMaxDivergence(),
    };
  }
}
