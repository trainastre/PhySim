import { FluidSimulation } from '../src/core/FluidSimulation.js';
import { FluidGrid } from '../src/core/FluidGrid.js';
import { FluidSolver } from '../src/core/FluidSolver.js';
import { BoundaryType } from '../src/core/BoundaryConditions.js';

export function runFluidSolverTests(assert) {
  console.log('--- Testing FluidSolver & Simulation Stability ---');

  // Test 1: Grid initialization & bounds check
  {
    const grid = new FluidGrid(32, 32);
    assert.strictEqual(grid.width, 32, 'Grid width should be 32');
    assert.strictEqual(grid.height, 32, 'Grid height should be 32');
    assert.strictEqual(grid.size, 1024, 'Grid size should be 1024');

    // Perimeter boundary should be solid by default
    assert.strictEqual(grid.isSolid(0, 0), true, 'Corner cell (0,0) is solid');
    assert.strictEqual(grid.isSolid(15, 0), true, 'Top boundary cell is solid');
    assert.strictEqual(grid.isSolid(0, 15), true, 'Left boundary cell is solid');
    assert.strictEqual(grid.isSolid(16, 16), false, 'Interior cell (16,16) is fluid');
  }

  // Test 2: Field updates without numerical divergence over hundreds of steps
  {
    const sim = new FluidSimulation({
      width: 32,
      height: 32,
      viscosity: 0.0001,
      diffusion: 0.00005,
      solverIterations: 30,
    });

    // Inject strong rotational velocities and high density
    sim.addDensitySplat(16, 16, 6, 100.0);
    sim.addVelocityImpulse(16, 16, 6, 50.0, -30.0);

    const initialMass = sim.getDiagnostics().totalDensity;
    assert.ok(initialMass > 0, 'Initial mass must be positive');

    // Simulate for 150 frames
    for (let step = 0; step < 150; step++) {
      sim.step(0.016);
      const { maxSpeed, maxDivergence, totalDensity } = sim.getDiagnostics();

      // Ensure no NaN or Infinity
      assert.ok(!Number.isNaN(maxSpeed), `maxSpeed is not NaN at step ${step}`);
      assert.ok(Number.isFinite(maxSpeed), `maxSpeed is finite at step ${step}`);
      assert.ok(!Number.isNaN(maxDivergence), `maxDivergence is not NaN at step ${step}`);
      assert.ok(Number.isFinite(maxDivergence), `maxDivergence is finite at step ${step}`);
      assert.ok(!Number.isNaN(totalDensity), `totalDensity is not NaN at step ${step}`);
      assert.ok(Number.isFinite(totalDensity), `totalDensity is finite at step ${step}`);

      // Divergence must remain well bounded (pressure projection ensures near-zero divergence)
      assert.ok(maxDivergence < 5.0, `Divergence remains bounded at step ${step}: ${maxDivergence}`);
    }

    console.log('  Passed: 150 simulation steps ran stably without divergence.');
  }

  // Test 3: Projection effectively minimizes divergence
  {
    const grid = new FluidGrid(32, 32);
    const solver = new FluidSolver(grid, { iterations: 40 });

    // Set an initially divergent velocity field (diverging outward from center)
    for (let y = 1; y < 31; y++) {
      for (let x = 1; x < 31; x++) {
        grid.setVelocity(x, y, (x - 16) * 2.0, (y - 16) * 2.0);
      }
    }

    const unprojectedDiv = solver.getMaxDivergence();

    // Perform pressure projection
    solver.project(grid.u, grid.v, grid.uPrev, grid.vPrev);

    const projectedDiv = solver.getMaxDivergence();
    assert.ok(projectedDiv < unprojectedDiv, `Projection reduced divergence from ${unprojectedDiv.toFixed(4)} to ${projectedDiv.toFixed(4)}`);
    console.log(`  Passed: Pressure solve reduced divergence from ${unprojectedDiv.toFixed(4)} to ${projectedDiv.toFixed(4)}`);
  }

  // Test 4: Semi-Lagrangian advection unconditional stability
  {
    const grid = new FluidGrid(16, 16);
    const solver = new FluidSolver(grid);

    // Seed density with peak value of 1.0
    grid.setDensity(8, 8, 1.0);
    grid.setVelocity(8, 8, 10.0, 0); // Large velocity

    // Step with a large dt that would violate CFL condition in explicit schemes
    solver.step(1.0);

    const buffer = grid.density;
    let maxVal = 0;
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] > maxVal) maxVal = buffer[i];
    }
    // Advection must not amplify peak density beyond 1.0
    assert.ok(maxVal <= 1.0001, `Semi-Lagrangian advection bounded: max ${maxVal} <= 1.0`);
    console.log('  Passed: Semi-Lagrangian advection bounded under extreme time step.');
  }

  // Test 5: Engine operates independently of UI / DOM
  {
    const sim = new FluidSimulation({ width: 24, height: 24 });
    sim.addDensitySplat(12, 12, 4, 10.0);
    sim.step(0.016);

    const u = sim.getVelocityBuffers().u;
    const v = sim.getVelocityBuffers().v;
    const density = sim.getDensityBuffer();
    const pressure = sim.getPressureBuffer();
    const divergence = sim.getDivergenceBuffer();

    assert.ok(u instanceof Float32Array, 'u is Float32Array');
    assert.ok(v instanceof Float32Array, 'v is Float32Array');
    assert.ok(density instanceof Float32Array, 'density is Float32Array');
    assert.ok(pressure instanceof Float32Array, 'pressure is Float32Array');
    assert.ok(divergence instanceof Float32Array, 'divergence is Float32Array');

    const sample = sim.sampleDensity(12.5, 12.5);
    assert.ok(typeof sample === 'number' && sample > 0, 'sampleDensity operates headlessly');

    console.log('  Passed: Engine operates 100% headlessly with typed array readouts.');
  }
}
