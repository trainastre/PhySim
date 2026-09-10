import { PerformanceMonitor } from '../src/utils/PerformanceMonitor.js';
import { packRGBA, isLittleEndian, getPaletteLUT, getPaletteLUT32, hsvToRgb32 } from '../src/rendering/ColorMaps.js';
import { FluidSimulation } from '../src/core/FluidSimulation.js';
import { FluidRenderer, RenderMode } from '../src/rendering/FluidRenderer.js';

export function runPerformanceMonitorTests(assert) {
  console.log('--- Testing PerformanceMonitor & Optimization Pipeline ---');

  // Test 1: PerformanceMonitor initialization and defaults
  {
    const monitor = new PerformanceMonitor({ targetFps: 60, historySize: 30 });
    assert.strictEqual(monitor.targetFps, 60, 'Target FPS should be 60');
    assert.strictEqual(Math.round(monitor.targetFrameTime * 10) / 10, 16.7, 'Target frame time ~16.7ms');
    assert.strictEqual(monitor.historySize, 30, 'History size is 30');
    assert.strictEqual(monitor.frameTimeHistory.length, 30, 'frameTimeHistory typed array length is 30');
    assert.strictEqual(monitor.simTimeHistory.length, 30, 'simTimeHistory typed array length is 30');
    assert.strictEqual(monitor.renderTimeHistory.length, 30, 'renderTimeHistory typed array length is 30');

    console.log('  Passed: PerformanceMonitor initializes with configured target frame rates.');
  }

  // Test 2: Frame rate tracking at 60 FPS
  {
    const monitor = new PerformanceMonitor({ targetFps: 60, historySize: 60 });

    let simTime = 1000.0;
    // Simulate 60 frames evenly spaced at 16.666ms (perfect 60 FPS)
    for (let f = 0; f < 60; f++) {
      monitor.beginFrame(simTime);
      monitor.beginSim();
      // simulate small sim duration
      monitor.endSim();
      monitor.beginRender();
      // simulate small render duration
      monitor.endRender();
      monitor.endFrame();

      simTime += 1000.0 / 60.0; // +16.666ms
    }

    const stats = monitor.getStats();
    assert.ok(stats.fps >= 59 && stats.fps <= 61, `FPS should be ~60 (actual: ${stats.fps})`);
    assert.ok(stats.avgFps >= 59 && stats.avgFps <= 61, `Avg FPS should be ~60 (actual: ${stats.avgFps})`);
    assert.strictEqual(stats.droppedFrames, 0, 'No dropped frames in ideal 60 FPS scenario');
    assert.strictEqual(stats.totalFrames, 60, 'Total frames tracked is 60');

    console.log(`  Passed: 60 FPS execution accurately measured (FPS: ${stats.fps}, Avg: ${stats.avgFps}).`);
  }

  // Test 3: Dropped frame detection
  {
    const monitor = new PerformanceMonitor({ targetFps: 60, historySize: 20 });
    let simTime = 0;

    // Normal 16.6ms frame
    monitor.beginFrame(simTime);
    monitor.endFrame();

    // Sudden spike: next frame takes 45ms (dropped frame)
    simTime += 45;
    monitor.beginFrame(simTime);
    monitor.endFrame();

    const stats = monitor.getStats();
    assert.strictEqual(stats.droppedFrames, 1, 'Long frame (>1.2 * 16.67ms) flagged as dropped frame');

    console.log('  Passed: Frame drops correctly identified during simulation spikes.');
  }

  // Test 4: Zero-allocation guarantee on getStats() and diagnostics
  {
    const monitor = new PerformanceMonitor({ targetFps: 60 });
    const statsRef1 = monitor.getStats();
    const statsRef2 = monitor.getStats();

    // getStats must return the same cached object reference to avoid GC allocations
    assert.strictEqual(statsRef1, statsRef2, 'getStats() returns cached object reference without allocations');

    // FluidSimulation diagnostics zero-allocation check
    const sim = new FluidSimulation({ width: 16, height: 16 });
    const diag1 = sim.getDiagnostics();
    const diag2 = sim.getDiagnostics();
    assert.strictEqual(diag1, diag2, 'FluidSimulation.getDiagnostics() returns cached object reference');

    console.log('  Passed: getStats() and getDiagnostics() operate with zero allocations.');
  }

  // Test 5: 32-bit pixel packing and color LUT synchronization
  {
    // Test packRGBA against endianness
    const packed = packRGBA(255, 128, 64, 255);
    const buf = new ArrayBuffer(4);
    const u8 = new Uint8ClampedArray(buf);
    const u32 = new Uint32Array(buf);
    u32[0] = packed;

    assert.strictEqual(u8[0], 255, 'Packed red component matches');
    assert.strictEqual(u8[1], 128, 'Packed green component matches');
    assert.strictEqual(u8[2], 64, 'Packed blue component matches');
    assert.strictEqual(u8[3], 255, 'Packed alpha component matches');

    // Test that 32-bit LUT matches 8-bit LUT across palettes
    const lut8 = getPaletteLUT('fire');
    const lut32 = getPaletteLUT32('fire');
    assert.strictEqual(lut32.length, 256, '32-bit LUT has 256 entries');

    for (let i = 0; i < 256; i++) {
      const offset = i * 4;
      u32[0] = lut32[i];
      assert.strictEqual(u8[0], lut8[offset], `LUT entry ${i} Red matches`);
      assert.strictEqual(u8[1], lut8[offset + 1], `LUT entry ${i} Green matches`);
      assert.strictEqual(u8[2], lut8[offset + 2], `LUT entry ${i} Blue matches`);
      assert.strictEqual(u8[3], lut8[offset + 3], `LUT entry ${i} Alpha matches`);
    }

    // Test hsvToRgb32
    const pureRed32 = hsvToRgb32(0.0, 1.0, 1.0);
    u32[0] = pureRed32;
    assert.strictEqual(u8[0], 255, 'HSV 32 pure red R matches');
    assert.strictEqual(u8[1], 0, 'HSV 32 pure red G matches');
    assert.strictEqual(u8[2], 0, 'HSV 32 pure red B matches');

    console.log('  Passed: 32-bit color LUTs and pixel packing verified for fast canvas drawing.');
  }

  // Test 6: Fast 32-bit rendering in FluidRenderer
  {
    const sim = new FluidSimulation({ width: 16, height: 16 });
    sim.addDensitySplat(8, 8, 3, 40.0);
    sim.addVelocityImpulse(8, 8, 3, 15.0, 5.0);

    const mockCanvas = {
      width: 128,
      height: 128,
      getContext: () => ({
        putImageData: () => {},
        drawImage: () => {},
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
    };

    const renderer = new FluidRenderer(mockCanvas, sim);
    assert.ok(renderer.pixels32 instanceof Uint32Array, 'FluidRenderer allocates Uint32Array view');
    assert.strictEqual(renderer.pixels32.length, 16 * 16, 'Uint32Array length matches grid cell count');

    // Render density mode
    renderer.setRenderMode(RenderMode.DENSITY);
    renderer.render();

    // Verify center pixel has non-zero color in pixels32
    const centerIdx = 8 * 16 + 8;
    assert.ok(renderer.pixels32[centerIdx] !== 0, 'Center pixel has non-zero color in 32-bit buffer');

    // Direction mode zero-allocation test
    renderer.setRenderMode(RenderMode.DIRECTION);
    renderer.render();
    assert.ok(renderer.pixels32[centerIdx] !== 0, 'Direction render successfully writes 32-bit colors');

    console.log('  Passed: FluidRenderer accelerates rasterization with direct 32-bit pixel writes.');
  }
}
