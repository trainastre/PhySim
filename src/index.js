/**
 * PhySim - 2D Fluid Simulation Engine
 * Core fluid dynamics library and real-time canvas rendering pipeline.
 */

export { FluidSimulation } from './core/FluidSimulation.js';
export { FluidSolver } from './core/FluidSolver.js';
export { FluidGrid } from './core/FluidGrid.js';
export { BoundaryConditions, BoundaryType } from './core/BoundaryConditions.js';
export { Advection } from './core/Advection.js';
export { clamp, lerp, bilinearSample } from './utils/MathUtils.js';

export { FluidRenderer, RenderMode } from './rendering/FluidRenderer.js';
export {
  ColorPalette,
  sampleColorMap,
  getPaletteLUT,
  getPaletteLUT32,
  packRGBA,
  hsvToRgb,
  hsvToRgb32,
} from './rendering/ColorMaps.js';
export { PointerController } from './ui/PointerController.js';
export { PerformanceMonitor } from './utils/PerformanceMonitor.js';
export { PhySimApp } from './ui/app.js';
