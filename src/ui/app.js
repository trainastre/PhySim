import { FluidSimulation } from '../core/FluidSimulation.js';
import { FluidRenderer, RenderMode } from '../rendering/FluidRenderer.js';
import { ColorPalette } from '../rendering/ColorMaps.js';
import { PointerController } from './PointerController.js';
import { PerformanceMonitor } from '../utils/PerformanceMonitor.js';

/**
 * PhySim Web Application Controller.
 * Manages 60 FPS simulation loop with fixed-timestep physics, responsive canvas scaling,
 * real-time UI parameter bindings, pointer gestures, and Browser DevTools profiling.
 */
export class PhySimApp {
  constructor() {
    this.canvas = document.getElementById('fluid-canvas');
    if (!this.canvas) {
      throw new Error('Canvas element #fluid-canvas not found.');
    }

    // Initialize fluid engine with default 64x64 grid
    this.sim = new FluidSimulation({
      width: 64,
      height: 64,
      viscosity: 0.0001,
      diffusion: 0.00001,
      densityDissipation: 0.005,
      gravityY: -6.0, // Mild upward buoyancy by default
      vorticityStrength: 1.2,
      solverIterations: 25,
    });

    // Initialize real-time canvas rendering pipeline
    this.renderer = new FluidRenderer(this.canvas, this.sim, {
      renderMode: RenderMode.DENSITY,
      colorPalette: ColorPalette.FIRE,
      showVectors: false,
      smoothScaling: true,
      maxDensityScale: 50.0,
      maxSpeedScale: 25.0,
    });

    // Application state
    this.isRunning = true;
    this.activeTool = 'fluid'; // 'fluid' | 'velocity' | 'obstacle' | 'erase'
    this.brushRadius = 3.5;

    // Interactive Mouse and Touch Pointer Controller
    this.pointerController = new PointerController({
      canvas: this.canvas,
      simulation: this.sim,
      renderer: this.renderer,
      activeTool: this.activeTool,
      brushRadius: this.brushRadius,
      forceScale: 0.8,
      densityAmount: 60.0,
      interpolate: true,
    });

    // Performance Monitoring & DevTools Profiler (Target: 60 FPS)
    this.perfMonitor = new PerformanceMonitor({
      targetFps: 60,
      historySize: 60,
      enableUserTiming: true,
    });

    // Fixed-timestep simulation accumulator for consistent 60 FPS physics
    this.accumulator = 0.0;
    this.fixedTimeStep = 1.0 / 60.0; // ~0.01667s per physics step
    this.maxSubSteps = 3;           // Bound sub-steps to prevent spiral of death

    this.lastFrameTime = performance.now();
    this.fps = 60;
    this.fpsTimer = performance.now();

    // Setup bindings
    this.initUIElements();
    this.bindControlEvents();
    this.handleViewportResize();

    // Load initial scene
    this.loadPreset('plume');

    // Expose app instance globally in browser for developer tools profiling
    if (typeof window !== 'undefined') {
      window.__physimApp = this;
    }

    // Start simulation loop
    window.addEventListener('resize', () => this.handleViewportResize());
    requestAnimationFrame((t) => this.loop(t));
  }

  get isPointerDown() {
    return this.pointerController ? this.pointerController.isPointerDown : false;
  }

  /**
   * Caches DOM UI control elements.
   */
  initUIElements() {
    this.ui = {
      // Core parameter sliders
      viscositySlider: document.getElementById('viscosity-slider'),
      viscosityVal: document.getElementById('viscosity-val'),
      gravitySlider: document.getElementById('gravity-slider'),
      gravityVal: document.getElementById('gravity-val'),
      dissipationSlider: document.getElementById('dissipation-slider'),
      dissipationVal: document.getElementById('dissipation-val'),
      diffusionSlider: document.getElementById('diffusion-slider'),
      diffusionVal: document.getElementById('diffusion-val'),
      vorticitySlider: document.getElementById('vorticity-slider'),
      vorticityVal: document.getElementById('vorticity-val'),
      iterationsSlider: document.getElementById('iterations-slider'),
      iterationsVal: document.getElementById('iterations-val'),

      // Visualization controls
      renderModeSelect: document.getElementById('render-mode-select'),
      colorPaletteSelect: document.getElementById('color-palette-select'),
      vectorToggle: document.getElementById('vector-toggle'),
      smoothToggle: document.getElementById('smooth-toggle'),

      // Tool modes
      toolRadios: document.querySelectorAll('input[name="tool-mode"]'),

      // Buttons
      pauseBtn: document.getElementById('pause-btn'),
      stepBtn: document.getElementById('step-btn'),
      resetFluidBtn: document.getElementById('reset-fluid-btn'),
      clearObstaclesBtn: document.getElementById('clear-obstacles-btn'),

      // Presets
      presetPlumeBtn: document.getElementById('preset-plume'),
      presetKarmanBtn: document.getElementById('preset-karman'),
      presetVorticesBtn: document.getElementById('preset-vortices'),
      presetZeroGBtn: document.getElementById('preset-zerog'),

      // Stats readouts
      fpsStat: document.getElementById('stat-fps'),
      speedStat: document.getElementById('stat-speed'),
      densityStat: document.getElementById('stat-density'),
      divStat: document.getElementById('stat-div'),
    };
  }

  /**
   * Binds UI control events for instant parameter updates.
   */
  bindControlEvents() {
    const { ui, sim, renderer, pointerController } = this;

    // 1. Viscosity slider
    if (ui.viscositySlider) {
      ui.viscositySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.viscosity = val;
        if (ui.viscosityVal) ui.viscosityVal.textContent = val.toFixed(4);
      });
    }

    // 2. Gravity slider
    if (ui.gravitySlider) {
      ui.gravitySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.gravityY = val;
        if (ui.gravityVal) ui.gravityVal.textContent = val.toFixed(1);
      });
    }

    // 3. Density dissipation slider
    if (ui.dissipationSlider) {
      ui.dissipationSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.densityDissipation = val;
        if (ui.dissipationVal) ui.dissipationVal.textContent = val.toFixed(3);
      });
    }

    // 4. Diffusion slider
    if (ui.diffusionSlider) {
      ui.diffusionSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.diffusion = val;
        if (ui.diffusionVal) ui.diffusionVal.textContent = val.toFixed(5);
      });
    }

    // 5. Vorticity strength slider
    if (ui.vorticitySlider) {
      ui.vorticitySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        sim.vorticityStrength = val;
        if (ui.vorticityVal) ui.vorticityVal.textContent = val.toFixed(1);
      });
    }

    // 6. Solver iterations slider
    if (ui.iterationsSlider) {
      ui.iterationsSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        sim.solverIterations = val;
        if (ui.iterationsVal) ui.iterationsVal.textContent = String(val);
      });
    }

    // Visualization select menus
    if (ui.renderModeSelect) {
      ui.renderModeSelect.addEventListener('change', (e) => {
        renderer.setRenderMode(e.target.value);
      });
    }

    if (ui.colorPaletteSelect) {
      ui.colorPaletteSelect.addEventListener('change', (e) => {
        renderer.setColorPalette(e.target.value);
      });
    }

    if (ui.vectorToggle) {
      ui.vectorToggle.addEventListener('change', (e) => {
        renderer.setShowVectors(e.target.checked);
      });
    }

    if (ui.smoothToggle) {
      ui.smoothToggle.addEventListener('change', (e) => {
        renderer.setSmoothScaling(e.target.checked);
      });
    }

    // Tool modes
    ui.toolRadios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.activeTool = e.target.value;
          if (pointerController) {
            pointerController.setActiveTool(e.target.value);
          }
        }
      });
    });

    // Action buttons
    if (ui.pauseBtn) {
      ui.pauseBtn.addEventListener('click', () => {
        this.isRunning = !this.isRunning;
        ui.pauseBtn.textContent = this.isRunning ? 'Pause' : 'Resume';
      });
    }

    if (ui.stepBtn) {
      ui.stepBtn.addEventListener('click', () => {
        sim.step(this.fixedTimeStep);
        renderer.render();
      });
    }

    if (ui.resetFluidBtn) {
      ui.resetFluidBtn.addEventListener('click', () => {
        sim.reset(false);
      });
    }

    if (ui.clearObstaclesBtn) {
      ui.clearObstaclesBtn.addEventListener('click', () => {
        sim.reset(true);
      });
    }

    // Preset buttons
    if (ui.presetPlumeBtn) ui.presetPlumeBtn.addEventListener('click', () => this.loadPreset('plume'));
    if (ui.presetKarmanBtn) ui.presetKarmanBtn.addEventListener('click', () => this.loadPreset('karman'));
    if (ui.presetVorticesBtn) ui.presetVorticesBtn.addEventListener('click', () => this.loadPreset('vortices'));
    if (ui.presetZeroGBtn) ui.presetZeroGBtn.addEventListener('click', () => this.loadPreset('zerog'));
  }

  /**
   * Directly applies user interaction to simulation.
   */
  applyInteraction(gx, gy, deltaX, deltaY) {
    if (this.pointerController) {
      this.pointerController.applyInteraction(gx, gy, deltaX, deltaY);
    }
  }

  /**
   * Handles canvas buffer scaling to match CSS viewport size and device pixel ratio.
   */
  handleViewportResize() {
    this.renderer.resizeToDisplaySize();
  }

  /**
   * Sets up predefined physics scenarios.
   */
  loadPreset(presetName) {
    const { sim } = this;
    const dims = sim.getDimensions();
    const cx = Math.floor(dims.width / 2);
    const cy = Math.floor(dims.height / 2);

    sim.reset(true);

    switch (presetName) {
      case 'plume': {
        // Upward smoke plume with obstacle
        sim.viscosity = 0.0001;
        sim.gravityY = -8.0;
        sim.densityDissipation = 0.005;
        sim.vorticityStrength = 1.5;

        // Circular obstacle in middle
        sim.setObstacleCircle(cx, cy - 6, 5, true);

        // Initial splats at bottom
        sim.addDensitySplat(cx, dims.height - 8, 5, 80.0);
        sim.addVelocityImpulse(cx, dims.height - 8, 5, 0, -25.0);
        break;
      }

      case 'karman': {
        // Horizontal flow past cylinder
        sim.viscosity = 0.00005;
        sim.gravityY = 0.0;
        sim.densityDissipation = 0.002;
        sim.vorticityStrength = 2.0;

        // Obstacle cylinder
        sim.setObstacleCircle(Math.floor(dims.width * 0.35), cy, 4, true);

        // Continuous horizontal inflow
        sim.addDensitySplat(6, cy, 6, 70.0);
        sim.addVelocityImpulse(6, cy, 6, 35.0, 0);
        break;
      }

      case 'vortices': {
        // Counter-rotating swirling vortices
        sim.viscosity = 0.00008;
        sim.gravityY = 0.0;
        sim.densityDissipation = 0.001;
        sim.vorticityStrength = 2.5;

        sim.addDensitySplat(cx - 10, cy, 5, 75.0);
        sim.addVelocityImpulse(cx - 10, cy, 5, 0, -30.0);

        sim.addDensitySplat(cx + 10, cy, 5, 75.0);
        sim.addVelocityImpulse(cx + 10, cy, 5, 0, 30.0);
        break;
      }

      case 'zerog': {
        // Zero-G fluid expansion splat
        sim.viscosity = 0.0002;
        sim.gravityY = 0.0;
        sim.densityDissipation = 0.004;
        sim.vorticityStrength = 0.8;

        sim.addDensitySplat(cx, cy, 8, 120.0);
        sim.addVelocityImpulse(cx, cy, 6, 20.0, -10.0);
        break;
      }
    }

    // Sync UI slider values
    this.syncSlidersFromSim();
  }

  /**
   * Synchronizes UI slider displays with current simulation parameters.
   */
  syncSlidersFromSim() {
    const { ui, sim } = this;
    if (ui.viscositySlider) {
      ui.viscositySlider.value = sim.viscosity;
      if (ui.viscosityVal) ui.viscosityVal.textContent = sim.viscosity.toFixed(4);
    }
    if (ui.gravitySlider) {
      ui.gravitySlider.value = sim.gravityY;
      if (ui.gravityVal) ui.gravityVal.textContent = sim.gravityY.toFixed(1);
    }
    if (ui.dissipationSlider) {
      ui.dissipationSlider.value = sim.densityDissipation;
      if (ui.dissipationVal) ui.dissipationVal.textContent = sim.densityDissipation.toFixed(3);
    }
    if (ui.diffusionSlider) {
      ui.diffusionSlider.value = sim.diffusion;
      if (ui.diffusionVal) ui.diffusionVal.textContent = sim.diffusion.toFixed(5);
    }
    if (ui.vorticitySlider) {
      ui.vorticitySlider.value = sim.vorticityStrength;
      if (ui.vorticityVal) ui.vorticityVal.textContent = sim.vorticityStrength.toFixed(1);
    }
    if (ui.iterationsSlider) {
      ui.iterationsSlider.value = sim.solverIterations;
      if (ui.iterationsVal) ui.iterationsVal.textContent = String(sim.solverIterations);
    }
  }

  /**
   * Main real-time simulation and rendering loop.
   * Profiles simulation and rendering phases, and ensures consistent 60 FPS execution
   * via fixed-timestep accumulation.
   */
  loop(currentTime) {
    this.perfMonitor.beginFrame(currentTime);

    const rawDt = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;
    const dt = Math.min(0.1, Math.max(0.0005, rawDt));

    // Fixed-timestep simulation steps for consistent 60 FPS physics
    if (this.isRunning) {
      this.perfMonitor.beginSim();
      this.accumulator += dt;
      let subSteps = 0;
      while (this.accumulator >= this.fixedTimeStep && subSteps < this.maxSubSteps) {
        this.sim.step(this.fixedTimeStep);
        this.accumulator -= this.fixedTimeStep;
        subSteps++;
      }
      // If still lagging behind (e.g. background tab or long stall), discard accumulator
      if (this.accumulator >= this.fixedTimeStep) {
        this.accumulator = 0;
      }
      this.perfMonitor.endSim();
    }

    // Render fluid state to canvas
    this.perfMonitor.beginRender();
    this.renderer.render();
    this.perfMonitor.endRender();

    this.perfMonitor.endFrame();

    // Update performance and physics diagnostics
    this.updateDiagnostics(currentTime);

    requestAnimationFrame((t) => this.loop(t));
  }

  /**
   * Updates diagnostic stats (FPS, execution timings, speeds, divergences, densities).
   */
  updateDiagnostics(currentTime) {
    if (currentTime - this.fpsTimer >= 250) {
      this.fpsTimer = currentTime;
      const perf = this.perfMonitor.getStats();
      this.fps = perf.fps;

      const diag = this.sim.getDiagnostics();
      const { ui } = this;

      if (ui.fpsStat) {
        ui.fpsStat.textContent = String(perf.fps);
        ui.fpsStat.title = `Frame: ${perf.frameTime.toFixed(1)}ms | Sim: ${perf.simTime.toFixed(1)}ms | Render: ${perf.renderTime.toFixed(1)}ms | Dropped: ${perf.droppedFrames}`;
      }
      if (ui.speedStat) ui.speedStat.textContent = diag.maxSpeed.toFixed(1);
      if (ui.densityStat) ui.densityStat.textContent = Math.round(diag.totalDensity).toLocaleString();
      if (ui.divStat) ui.divStat.textContent = diag.maxDivergence.toFixed(3);
    }
  }

  /**
   * Returns current real-time performance telemetry.
   * Accessible via browser DevTools console: `__physimApp.getPerformanceStats()`.
   */
  getPerformanceStats() {
    return this.perfMonitor.getStats();
  }

  /**
   * Starts browser developer tools CPU profiler.
   * @param {string} [label='PhySim']
   */
  startProfiling(label = 'PhySim') {
    this.perfMonitor.startProfile(label);
  }

  /**
   * Stops browser developer tools CPU profiler.
   * @param {string} [label='PhySim']
   */
  stopProfiling(label = 'PhySim') {
    this.perfMonitor.stopProfile(label);
  }
}

// Auto-initialize when DOM is ready in browser environment
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new PhySimApp());
  } else {
    new PhySimApp();
  }
}
