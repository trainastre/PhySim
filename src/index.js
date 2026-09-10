/**
 * PhySim - 2D Fluid Simulation Engine
 * Core fluid dynamics library.
 */

export { FluidSimulation } from './core/FluidSimulation.js';
export { FluidSolver } from './core/FluidSolver.js';
export { FluidGrid } from './core/FluidGrid.js';
export { BoundaryConditions, BoundaryType } from './core/BoundaryConditions.js';
export { Advection } from './core/Advection.js';
export { clamp, lerp, bilinearSample } from './utils/MathUtils.js';
