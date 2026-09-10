/**
 * Example demonstrating headless execution of the PhySim Fluid Engine.
 * Runs a smoke simulation with an obstacle, completely decoupled from any UI/canvas.
 */

import { FluidSimulation } from '../src/index.js';

// 1. Initialize simulation grid
const sim = new FluidSimulation({
  width: 32,
  height: 32,
  viscosity: 0.0001,
  diffusion: 0.00005,
  solverIterations: 25,
  gravityY: -9.8, // Buoyancy / upward gravity effect
});

// 2. Add an obstacle in the path of the rising fluid
sim.setObstacleCircle(16, 14, 3, true);

// 3. Inject fluid density source and velocity at the bottom
console.log('Injecting fluid density and upward velocity...');
sim.addDensitySplat(16, 26, 4, 100.0);
sim.addVelocityImpulse(16, 26, 4, 0, -20.0);

console.log('Running 60 headless simulation steps (1 second of physics at 60 FPS)...\n');

for (let step = 1; step <= 60; step++) {
  sim.step(1 / 60);

  if (step % 15 === 0) {
    const diag = sim.getDiagnostics();
    console.log(
      `Step ${String(step).padStart(2)} | ` +
      `Time: ${diag.time.toFixed(3)}s | ` +
      `Total Density: ${diag.totalDensity.toFixed(2)} | ` +
      `Max Speed: ${diag.maxSpeed.toFixed(2)} | ` +
      `Max Div: ${diag.maxDivergence.toFixed(4)}`
    );
  }
}

// 4. Sample fluid state at probe points
const centerDensity = sim.sampleDensity(16, 8);
const centerVelocity = sim.sampleVelocity(16, 8);

console.log('\nProbe sample at (16, 8) above obstacle:');
console.log(`  Density:  ${centerDensity.toFixed(3)}`);
console.log(`  Velocity: u=${centerVelocity.u.toFixed(3)}, v=${centerVelocity.v.toFixed(3)}`);
console.log('\nHeadless simulation completed successfully.');
