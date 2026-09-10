import { BoundaryConditions, BoundaryType } from './BoundaryConditions.js';
import { Advection } from './Advection.js';

/**
 * Core Eulerian 2D Fluid Dynamics Solver based on the Navier-Stokes equations
 * (Stable Fluids method with projection, diffusion, and semi-Lagrangian advection).
 *
 * Guarantees incompressibility (divergence-free velocity), physical boundary enforcement,
 * and unconditional numerical stability without divergence/blowup.
 */
export class FluidSolver {
  /**
   * @param {FluidGrid} grid - The underlying fluid grid.
   * @param {Object} [options={}] - Simulation configuration parameters.
   * @param {number} [options.viscosity=0.0] - Kinematic viscosity of the fluid.
   * @param {number} [options.diffusion=0.0] - Diffusion coefficient for density/dye.
   * @param {number} [options.iterations=25] - Gauss-Seidel solver iteration count.
   * @param {string} [options.boundaryType=BoundaryType.FREE_SLIP] - Boundary condition mode.
   * @param {number} [options.gravityX=0.0] - Constant horizontal gravity/force.
   * @param {number} [options.gravityY=0.0] - Constant vertical gravity/force.
   * @param {number} [options.vorticityStrength=0.0] - Vorticity confinement strength.
   */
  constructor(grid, options = {}) {
    if (!grid) {
      throw new Error('FluidSolver requires a valid FluidGrid instance.');
    }

    this.grid = grid;
    this.viscosity = options.viscosity ?? 0.0;
    this.diffusion = options.diffusion ?? 0.0;
    this.iterations = options.iterations ?? 25;
    this.boundaryType = options.boundaryType ?? BoundaryType.FREE_SLIP;
    this.gravityX = options.gravityX ?? 0.0;
    this.gravityY = options.gravityY ?? 0.0;
    this.vorticityStrength = options.vorticityStrength ?? 0.0;

    // Internal scratch buffer for vorticity calculations if enabled
    this._curl = null;
  }

  /**
   * Advances the fluid simulation by one time step dt.
   * 
   * Steps:
   * 1. Add external forces (gravity, inputs).
   * 2. Viscous velocity diffusion.
   * 3. Pressure projection (divergence-free enforcement).
   * 4. Semi-Lagrangian velocity advection.
   * 5. Pressure projection (enforce mass conservation after advection).
   * 6. Density diffusion.
   * 7. Density advection.
   * 8. Boundary condition enforcement.
   * 
   * @param {number} [dt=0.016] - Time step in seconds.
   */
  step(dt = 0.016) {
    if (dt <= 0) return;

    const { grid } = this;
    const { width, height, dx, u, v, uPrev, vPrev, density, densityPrev, solid } = grid;

    // Apply external constant body forces (e.g. gravity)
    if (this.gravityX !== 0 || this.gravityY !== 0) {
      this.applyBodyForces(dt);
    }

    // Apply optional vorticity confinement
    if (this.vorticityStrength > 0) {
      this.applyVorticityConfinement(dt);
    }

    // Velocity step:
    // Diffusion (if viscosity > 0)
    if (this.viscosity > 0) {
      uPrev.set(u);
      vPrev.set(v);
      this.diffuse(u, uPrev, this.viscosity, dt, 1);
      this.diffuse(v, vPrev, this.viscosity, dt, 2);
    }

    // Projection before advection
    this.project(u, v, uPrev, vPrev);

    // Advection of velocity
    uPrev.set(u);
    vPrev.set(v);
    Advection.advect(u, uPrev, uPrev, vPrev, solid, width, height, dt, dx);
    Advection.advect(v, vPrev, uPrev, vPrev, solid, width, height, dt, dx);

    // Boundary conditions on velocity
    BoundaryConditions.applyVelocity(grid, this.boundaryType);

    // Projection after advection to ensure divergence-free field
    this.project(u, v, uPrev, vPrev);

    // Density step:
    // Diffusion (if diffusion > 0)
    if (this.diffusion > 0) {
      densityPrev.set(density);
      this.diffuse(density, densityPrev, this.diffusion, dt, 0);
    }

    // Advection of density
    densityPrev.set(density);
    Advection.advect(density, densityPrev, u, v, solid, width, height, dt, dx);

    // Scalar boundary condition for density
    BoundaryConditions.applyScalar(grid, density);

    // Final boundary check on velocities
    BoundaryConditions.applyVelocity(grid, this.boundaryType);
  }

  /**
   * Applies constant body forces (like gravity) across fluid cells.
   * @param {number} dt - Time step.
   */
  applyBodyForces(dt) {
    const { width, height, u, v, solid } = this.grid;
    const gx = this.gravityX * dt;
    const gy = this.gravityY * dt;

    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (solid[idx] === 0) {
          u[idx] += gx;
          v[idx] += gy;
        }
      }
    }
  }

  /**
   * Applies vorticity confinement to counteract numerical dissipation
   * and preserve small eddy turbulence.
   * @param {number} dt - Time step.
   */
  applyVorticityConfinement(dt) {
    const { width, height, u, v, solid } = this.grid;
    const totalSize = width * height;

    if (!this._curl || this._curl.length !== totalSize) {
      this._curl = new Float32Array(totalSize);
    }
    const curl = this._curl;

    // Compute curl (vorticity omega = dv/dx - du/dy)
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (solid[idx] === 1) {
          curl[idx] = 0;
          continue;
        }
        const dv_dx = (v[idx + 1] - v[idx - 1]) * 0.5;
        const du_dy = (u[idx + width] - u[idx - width]) * 0.5;
        curl[idx] = dv_dx - du_dy;
      }
    }

    // Compute gradient of |curl| and apply perpendicular force
    const scale = this.vorticityStrength * dt;
    for (let y = 2; y < height - 2; y++) {
      const row = y * width;
      for (let x = 2; x < width - 2; x++) {
        const idx = row + x;
        if (solid[idx] === 1) continue;

        const dw_dx = (Math.abs(curl[idx + 1]) - Math.abs(curl[idx - 1])) * 0.5;
        const dw_dy = (Math.abs(curl[idx + width]) - Math.abs(curl[idx - width])) * 0.5;

        const len = Math.hypot(dw_dx, dw_dy) + 1e-6;
        const nx = dw_dx / len;
        const ny = dw_dy / len;

        // Force is perpendicular to gradient: F = N x omega
        const omega = curl[idx];
        u[idx] += scale * (ny * omega);
        v[idx] += scale * (-nx * omega);
      }
    }
  }

  /**
   * Implicit diffusion solver using Gauss-Seidel relaxation.
   * Solves (I - dt * diff * laplacian) x = x0
   * 
   * @param {Float32Array} x - Target field.
   * @param {Float32Array} x0 - Initial source field.
   * @param {number} diff - Diffusion coefficient.
   * @param {number} dt - Time step.
   * @param {number} b - Boundary type indicator (0: scalar, 1: u, 2: v).
   */
  diffuse(x, x0, diff, dt, b) {
    const { width, height, dx, solid } = this.grid;
    const a = dt * diff * (width * height) / (dx * dx);
    const denom = 1.0 + 4.0 * a;

    for (let k = 0; k < this.iterations; k++) {
      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let col = 1; col < width - 1; col++) {
          const idx = row + col;
          if (solid[idx] === 1) continue;

          x[idx] = (x0[idx] + a * (x[idx - 1] + x[idx + 1] + x[idx - width] + x[idx + width])) / denom;
        }
      }
      BoundaryConditions.applyStamBoundary(this.grid, x, b);
    }
  }

  /**
   * Pressure projection step (Helmholtz-Hodge decomposition).
   * Solves the Poisson equation for pressure: \nabla^2 p = \nabla \cdot u*
   * and subtracts the pressure gradient: u = u* - \nabla p
   * to ensure a strictly divergence-free velocity field (\nabla \cdot u = 0).
   *
   * @param {Float32Array} u - Velocity X field.
   * @param {Float32Array} v - Velocity Y field.
   * @param {Float32Array} p - Pressure scratch/storage buffer.
   * @param {Float32Array} div - Divergence scratch/storage buffer.
   */
  project(u, v, p, div) {
    const { width, height, dx, solid, pressure, divergence } = this.grid;
    const h = dx;

    // 1. Compute discrete divergence
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (solid[idx] === 1) {
          div[idx] = 0;
          p[idx] = 0;
          continue;
        }

        // Discrete central difference divergence
        const du = u[idx + 1] - u[idx - 1];
        const dv = v[idx + width] - v[idx - width];
        div[idx] = -0.5 * h * (du + dv);
        p[idx] = 0;
      }
    }

    BoundaryConditions.applyStamBoundary(this.grid, div, 0);
    BoundaryConditions.applyStamBoundary(this.grid, p, 0);

    // 2. Solve Poisson equation for pressure using Gauss-Seidel relaxation
    for (let k = 0; k < this.iterations; k++) {
      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let x = 1; x < width - 1; x++) {
          const idx = row + x;
          if (solid[idx] === 1) continue;

          // Account for neighboring solid obstacles with Neumann boundary condition (dp/dn = 0)
          let pLeft = p[idx - 1];
          let pRight = p[idx + 1];
          let pTop = p[idx - width];
          let pBtm = p[idx + width];

          if (solid[idx - 1] === 1) pLeft = p[idx];
          if (solid[idx + 1] === 1) pRight = p[idx];
          if (solid[idx - width] === 1) pTop = p[idx];
          if (solid[idx + width] === 1) pBtm = p[idx];

          p[idx] = (div[idx] + pLeft + pRight + pTop + pBtm) * 0.25;
        }
      }
      BoundaryConditions.applyStamBoundary(this.grid, p, 0);
    }

    // 3. Subtract pressure gradient from velocity to enforce incompressibility
    const invH2 = 0.5 / h;
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (solid[idx] === 1) {
          u[idx] = 0;
          v[idx] = 0;
          continue;
        }

        let pLeft = p[idx - 1];
        let pRight = p[idx + 1];
        let pTop = p[idx - width];
        let pBtm = p[idx + width];

        if (solid[idx - 1] === 1) pLeft = p[idx];
        if (solid[idx + 1] === 1) pRight = p[idx];
        if (solid[idx - width] === 1) pTop = p[idx];
        if (solid[idx + width] === 1) pBtm = p[idx];

        u[idx] -= invH2 * (pRight - pLeft);
        v[idx] -= invH2 * (pBtm - pTop);
      }
    }

    // Store computed pressure and true divergence in grid for external inspection
    pressure.set(p);
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (solid[idx] === 1) {
          divergence[idx] = 0;
        } else {
          divergence[idx] = (u[idx + 1] - u[idx - 1] + v[idx + width] - v[idx - width]) * (0.5 / h);
        }
      }
    }

    BoundaryConditions.applyVelocity(this.grid, this.boundaryType);
  }

  /**
   * Adds an external velocity impulse to cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @param {number} fx - Force / velocity X.
   * @param {number} fy - Force / velocity Y.
   * @param {number} dt - Time step.
   */
  addForce(x, y, fx, fy, dt) {
    if (!this.grid.isInBounds(x, y) || this.grid.isSolid(x, y)) return;
    const idx = this.grid.index(x, y);
    this.grid.u[idx] += fx * dt;
    this.grid.v[idx] += fy * dt;
  }

  /**
   * Adds scalar density at cell (x, y).
   * @param {number} x - Cell x coordinate.
   * @param {number} y - Cell y coordinate.
   * @param {number} amount - Density amount.
   */
  addDensity(x, y, amount) {
    this.grid.addDensity(x, y, amount);
  }

  /**
   * Calculates the maximum absolute divergence across all fluid cells.
   * Useful for validating mass conservation and incompressibility.
   * @returns {number} Maximum divergence magnitude.
   */
  getMaxDivergence() {
    const { width, height, divergence, solid } = this.grid;
    let maxDiv = 0;
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const idx = row + x;
        if (solid[idx] === 0) {
          const val = Math.abs(divergence[idx]);
          if (val > maxDiv) maxDiv = val;
        }
      }
    }
    return maxDiv;
  }

  /**
   * Computes total density currently in the simulation domain.
   * @returns {number} Total density sum.
   */
  getTotalDensity() {
    const { density, solid } = this.grid;
    let sum = 0;
    for (let i = 0; i < density.length; i++) {
      if (solid[i] === 0) {
        sum += density[i];
      }
    }
    return sum;
  }

  /**
   * Computes maximum fluid speed (hypot(u, v)) in the domain.
   * @returns {number} Max speed.
   */
  getMaxSpeed() {
    const { u, v, solid } = this.grid;
    let maxSpeedSq = 0;
    for (let i = 0; i < u.length; i++) {
      if (solid[i] === 0) {
        const speedSq = u[i] * u[i] + v[i] * v[i];
        if (speedSq > maxSpeedSq) maxSpeedSq = speedSq;
      }
    }
    return Math.sqrt(maxSpeedSq);
  }
}
