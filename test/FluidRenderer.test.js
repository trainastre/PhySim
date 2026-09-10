import { FluidSimulation } from '../src/core/FluidSimulation.js';
import { FluidRenderer, RenderMode } from '../src/rendering/FluidRenderer.js';
import { ColorPalette, sampleColorMap, getPaletteLUT, hsvToRgb } from '../src/rendering/ColorMaps.js';

export function runFluidRendererTests(assert) {
  console.log('--- Testing FluidRenderer & Color Mapping Pipeline ---');

  // Test 1: ColorMaps LUT generation and bounds
  {
    const palettes = [
      ColorPalette.FIRE,
      ColorPalette.OCEAN,
      ColorPalette.TURBO,
      ColorPalette.INFERNO,
      ColorPalette.GREYSCALE,
      ColorPalette.NEON,
    ];

    for (const palette of palettes) {
      const lut = getPaletteLUT(palette);
      assert.strictEqual(lut.length, 1024, `Palette LUT ${palette} length must be 256 * 4 = 1024`);

      // Verify sample at t=0, t=0.5, t=1.0
      const c0 = sampleColorMap(palette, 0.0);
      const cMid = sampleColorMap(palette, 0.5);
      const c1 = sampleColorMap(palette, 1.0);

      assert.strictEqual(c0.length, 4, 'RGBA sample length is 4');
      assert.strictEqual(c0[3], 255, 'Alpha is 255');
      assert.strictEqual(cMid[3], 255, 'Alpha is 255');
      assert.strictEqual(c1[3], 255, 'Alpha is 255');

      // Clamping check
      const underflow = sampleColorMap(palette, -5.0);
      const overflow = sampleColorMap(palette, 10.0);
      assert.deepStrictEqual(underflow, c0, 'Underflow clamped to t=0');
      assert.deepStrictEqual(overflow, c1, 'Overflow clamped to t=1');
    }

    // Test HSV to RGB conversion
    const rgbRed = hsvToRgb(0.0, 1.0, 1.0);
    assert.strictEqual(rgbRed[0], 255, 'HSV(0, 1, 1) is pure red');
    assert.strictEqual(rgbRed[1], 0, 'HSV(0, 1, 1) has 0 green');
    assert.strictEqual(rgbRed[2], 0, 'HSV(0, 1, 1) has 0 blue');

    console.log('  Passed: Color palette LUTs and HSV converters generated and validated.');
  }

  // Test 2: Instant parameter adjustments on FluidSimulation
  {
    const sim = new FluidSimulation({
      width: 32,
      height: 32,
      viscosity: 0.0001,
      gravityY: 0.0,
      densityDissipation: 0.0,
    });

    // Test initial values
    assert.strictEqual(sim.viscosity, 0.0001, 'Initial viscosity is 0.0001');
    assert.strictEqual(sim.gravityY, 0.0, 'Initial gravityY is 0.0');
    assert.strictEqual(sim.densityDissipation, 0.0, 'Initial densityDissipation is 0.0');

    // Dynamically adjust parameters (simulating UI slider input)
    sim.viscosity = 0.0025;
    assert.strictEqual(sim.solver.viscosity, 0.0025, 'Viscosity updated instantly on solver');
    assert.strictEqual(sim.viscosity, 0.0025, 'Viscosity getter matches updated value');

    sim.gravityY = -9.8;
    assert.strictEqual(sim.solver.gravityY, -9.8, 'Gravity Y updated instantly on solver');
    assert.strictEqual(sim.gravityY, -9.8, 'Gravity Y getter matches updated value');

    sim.gravityX = 4.2;
    assert.strictEqual(sim.solver.gravityX, 4.2, 'Gravity X updated instantly on solver');

    sim.densityDissipation = 0.02;
    assert.strictEqual(sim.solver.densityDissipation, 0.02, 'Density dissipation updated instantly on solver');

    sim.diffusion = 0.0003;
    assert.strictEqual(sim.solver.diffusion, 0.0003, 'Diffusion updated instantly on solver');

    sim.vorticityStrength = 2.0;
    assert.strictEqual(sim.solver.vorticityStrength, 2.0, 'Vorticity strength updated instantly on solver');

    sim.solverIterations = 40;
    assert.strictEqual(sim.solver.iterations, 40, 'Solver iterations updated instantly on solver');

    console.log('  Passed: All core simulation parameters update instantly upon adjustment.');
  }

  // Test 3: Density dissipation physics verification
  {
    const simWithDissipation = new FluidSimulation({
      width: 16,
      height: 16,
      densityDissipation: 0.5,
    });

    const simNoDissipation = new FluidSimulation({
      width: 16,
      height: 16,
      densityDissipation: 0.0,
    });

    // Inject identical density
    simWithDissipation.addDensitySplat(8, 8, 3, 50.0);
    simNoDissipation.addDensitySplat(8, 8, 3, 50.0);

    const initialTotal = simNoDissipation.solver.getTotalDensity();

    // Step both simulations for 20 frames
    for (let i = 0; i < 20; i++) {
      simWithDissipation.step(0.016);
      simNoDissipation.step(0.016);
    }

    const dissipatedTotal = simWithDissipation.solver.getTotalDensity();
    const preservedTotal = simNoDissipation.solver.getTotalDensity();

    assert.ok(
      dissipatedTotal < preservedTotal,
      `Dissipated density (${dissipatedTotal.toFixed(2)}) must be less than non-dissipated (${preservedTotal.toFixed(2)})`
    );
    assert.ok(
      Math.abs(preservedTotal - initialTotal) < 0.1,
      'Density without dissipation is fully conserved'
    );

    console.log(`  Passed: Density dissipation properly decays fluid mass (${initialTotal.toFixed(1)} -> ${dissipatedTotal.toFixed(1)}).`);
  }

  // Test 4: FluidRenderer rendering across all modes & palettes
  {
    const sim = new FluidSimulation({ width: 24, height: 24 });
    sim.addDensitySplat(12, 12, 4, 30.0);
    sim.addVelocityImpulse(12, 12, 4, 10.0, -15.0);
    sim.setObstacleCircle(6, 6, 2, true);

    // Mock HTML5 Canvas for headless environment
    const mockCanvas = {
      width: 480,
      height: 480,
      clientWidth: 480,
      clientHeight: 480,
      getContext: () => ({
        putImageData: () => {},
        drawImage: () => {},
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        closePath: () => {},
        save: () => {},
        restore: () => {},
        imageSmoothingEnabled: true,
      }),
      getBoundingClientRect: () => ({
        left: 50,
        top: 100,
        width: 400,
        height: 400,
      }),
    };

    const renderer = new FluidRenderer(mockCanvas, sim);

    // Test all render modes
    const modes = [
      RenderMode.DENSITY,
      RenderMode.VELOCITY,
      RenderMode.DIRECTION,
      RenderMode.PRESSURE,
      RenderMode.DIVERGENCE,
    ];

    for (const mode of modes) {
      renderer.setRenderMode(mode);
      assert.strictEqual(renderer.renderMode, mode, `Active mode should be ${mode}`);
      renderer.render();
      assert.strictEqual(renderer.pixels.length, 24 * 24 * 4, 'Pixel buffer length matches grid');
    }

    // Test vector overlay
    renderer.setShowVectors(true);
    renderer.render();
    renderer.setShowVectors(false);

    // Test switching palettes
    renderer.setColorPalette(ColorPalette.OCEAN);
    assert.strictEqual(renderer.colorPalette, ColorPalette.OCEAN, 'Color palette updated');
    renderer.render();

    renderer.setColorPalette(ColorPalette.TURBO);
    renderer.render();

    console.log('  Passed: FluidRenderer rasterizes all render modes and color palettes without error.');
  }

  // Test 5: Canvas scaling and viewport coordinate mapping
  {
    const sim = new FluidSimulation({ width: 32, height: 32 });
    const mockCanvas = {
      width: 320,
      height: 320,
      clientWidth: 640,
      clientHeight: 640,
      getContext: () => ({
        putImageData: () => {},
        drawImage: () => {},
        clearRect: () => {},
      }),
      getBoundingClientRect: () => ({
        left: 100,
        top: 200,
        width: 800,  // Stretched display on high-res desktop
        height: 800,
      }),
    };

    const renderer = new FluidRenderer(mockCanvas, sim);

    // Test resizeToDisplaySize adapting to display with DPR 2.0
    const resized = renderer.resizeToDisplaySize(2.0);
    assert.strictEqual(resized, true, 'Canvas was resized to display dimensions * dpr');
    assert.strictEqual(mockCanvas.width, 1280, 'Canvas buffer width matches 640 * 2');
    assert.strictEqual(mockCanvas.height, 1280, 'Canvas buffer height matches 640 * 2');

    // Test coordinate mapping from screen viewport to grid
    // Top-left corner of canvas: clientX = 100, clientY = 200 -> grid (0, 0)
    const topLeft = renderer.clientToGrid(100, 200);
    assert.strictEqual(topLeft.x, 0, 'Top-left maps to grid X = 0');
    assert.strictEqual(topLeft.y, 0, 'Top-left maps to grid Y = 0');

    // Center of canvas: clientX = 100 + 400 = 500, clientY = 200 + 400 = 600 -> grid (16, 16)
    const center = renderer.clientToGrid(500, 600);
    assert.strictEqual(Math.round(center.x), 16, 'Center maps to grid X = 16');
    assert.strictEqual(Math.round(center.y), 16, 'Center maps to grid Y = 16');

    // Bottom-right corner of canvas: clientX = 900, clientY = 1000 -> grid (31, 31)
    const btmRight = renderer.clientToGrid(900, 1000);
    assert.strictEqual(Math.round(btmRight.x), 31, 'Bottom-right maps to grid X = 31');
    assert.strictEqual(Math.round(btmRight.y), 31, 'Bottom-right maps to grid Y = 31');

    // Out-of-bounds clicks are clamped to valid grid cells
    const outside = renderer.clientToGrid(-500, 2000);
    assert.strictEqual(outside.x, 0, 'Outside left is clamped to 0');
    assert.strictEqual(outside.y, 31, 'Outside bottom is clamped to 31');

    // Test clientToCanvas mapping
    const canvasTopLeft = renderer.clientToCanvas(100, 200);
    assert.strictEqual(canvasTopLeft.x, 0, 'Top-left maps to canvas X = 0');
    assert.strictEqual(canvasTopLeft.y, 0, 'Top-left maps to canvas Y = 0');

    const canvasCenter = renderer.clientToCanvas(500, 600);
    assert.strictEqual(canvasCenter.x, 640, 'Center maps to canvas X = 640');
    assert.strictEqual(canvasCenter.y, 640, 'Center maps to canvas Y = 640');

    const canvasBtmRight = renderer.clientToCanvas(900, 1000);
    assert.strictEqual(canvasBtmRight.x, 1280, 'Bottom-right maps to canvas X = 1280');
    assert.strictEqual(canvasBtmRight.y, 1280, 'Bottom-right maps to canvas Y = 1280');

    // Test canvasToGrid mapping
    const fromCanvas = renderer.canvasToGrid(640, 640);
    assert.strictEqual(Math.round(fromCanvas.x), 16, 'Canvas center converts to grid cell 16');
    assert.strictEqual(Math.round(fromCanvas.y), 16, 'Canvas center converts to grid cell 16');

    console.log('  Passed: Canvas scaling and client-to-grid coordinate transforms adapt across viewports.');
  }
}
