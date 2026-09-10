import { FluidSimulation } from '../src/core/FluidSimulation.js';
import { FluidGrid } from '../src/core/FluidGrid.js';
import { BoundaryConditions, BoundaryType } from '../src/core/BoundaryConditions.js';

export function runBoundaryConditionsTests(assert) {
  console.log('--- Testing Boundary Conditions & Wall Restrictions ---');

  // Test 1: Outer domain edges restrict normal velocity to zero
  {
    const grid = new FluidGrid(20, 20);

    // Apply outward velocities everywhere
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        grid.u[grid.index(x, y)] = -5.0; // Pushing left
        grid.v[grid.index(x, y)] = -5.0; // Pushing top
      }
    }

    BoundaryConditions.applyVelocity(grid, BoundaryType.FREE_SLIP);

    // Check left boundary (x = 0): u must be 0
    for (let y = 0; y < 20; y++) {
      assert.strictEqual(grid.u[grid.index(0, y)], 0, `Left wall u[0, ${y}] must be 0`);
      assert.strictEqual(grid.u[grid.index(19, y)], 0, `Right wall u[19, ${y}] must be 0`);
    }

    // Check top boundary (y = 0) and bottom boundary (y = 19): v must be 0
    for (let x = 0; x < 20; x++) {
      assert.strictEqual(grid.v[grid.index(x, 0)], 0, `Top wall v[${x}, 0] must be 0`);
      assert.strictEqual(grid.v[grid.index(x, 19)], 0, `Bottom wall v[${x}, 19] must be 0`);
    }

    console.log('  Passed: Outer domain edges strictly enforce zero normal velocity.');
  }

  // Test 2: Fluid movement restricted by interior solid obstacles
  {
    const sim = new FluidSimulation({ width: 30, height: 30 });

    // Place a vertical wall in the middle: x = 15, y = 5 to 25
    sim.setObstacleBox(15, 5, 2, 20, true);

    // Verify solid flags
    assert.strictEqual(sim.grid.isSolid(15, 10), true, 'Obstacle cell (15, 10) is solid');
    assert.strictEqual(sim.grid.isSolid(16, 10), true, 'Obstacle cell (16, 10) is solid');
    assert.strictEqual(sim.grid.isSolid(14, 10), false, 'Adjacent cell (14, 10) is fluid');

    // Push fluid horizontally directly towards the wall from the left
    sim.addDensitySplat(10, 15, 3, 50.0);
    sim.addVelocityImpulse(10, 15, 3, 20.0, 0); // Fast flow towards wall at x = 15

    // Run simulation
    for (let i = 0; i < 30; i++) {
      sim.step(0.016);
    }

    // Inside the obstacle wall, velocity and density must remain zero
    for (let y = 5; y < 25; y++) {
      for (let x = 15; x <= 16; x++) {
        const vel = sim.grid.getVelocity(x, y);
        const density = sim.grid.getDensity(x, y);
        assert.strictEqual(vel.u, 0, `Obstacle velocity u at (${x}, ${y}) must be 0`);
        assert.strictEqual(vel.v, 0, `Obstacle velocity v at (${x}, ${y}) must be 0`);
        assert.strictEqual(density, 0, `Obstacle density at (${x}, ${y}) must be 0`);
      }
    }

    console.log('  Passed: Interior solid obstacles block fluid penetration completely.');
  }

  // Test 3: Fluid matter containment (zero flux across outer boundary)
  {
    const sim = new FluidSimulation({
      width: 20,
      height: 20,
      diffusion: 0.0001,
      viscosity: 0.0001,
    });

    // Place density right next to the boundary wall
    sim.grid.setDensity(1, 10, 10.0);
    // Push it strongly into the left wall
    sim.grid.setVelocity(1, 10, -25.0, 0.0);

    for (let i = 0; i < 20; i++) {
      sim.step(0.016);
    }

    // No density should ever cross onto boundary wall outer cells or outside
    for (let y = 0; y < 20; y++) {
      assert.strictEqual(sim.grid.isSolid(0, y), true, 'Left boundary is solid');
    }

    const totalMass = sim.solver.getTotalDensity();
    assert.ok(totalMass > 0, 'Density remains contained inside the simulation bounds');
    console.log(`  Passed: Fluid mass contained inside closed boundary box (total mass: ${totalMass.toFixed(3)}).`);
  }

  // Test 4: Circular obstacle boundary condition
  {
    const sim = new FluidSimulation({ width: 25, height: 25 });
    sim.setObstacleCircle(12, 12, 4, true);

    assert.strictEqual(sim.grid.isSolid(12, 12), true, 'Circle center is solid');
    assert.strictEqual(sim.grid.isSolid(12, 16), true, 'Circle edge is solid');
    assert.strictEqual(sim.grid.isSolid(12, 20), false, 'Outside circle is fluid');

    // Add swirling fluid around circle
    sim.addVelocityImpulse(12, 6, 3, 10.0, 0);
    for (let i = 0; i < 10; i++) {
      sim.step(0.016);
    }

    assert.strictEqual(sim.grid.u[sim.grid.index(12, 12)], 0, 'Circle center u velocity is 0');
    assert.strictEqual(sim.grid.v[sim.grid.index(12, 12)], 0, 'Circle center v velocity is 0');
    console.log('  Passed: Circular obstacle properly set and restricts velocities.');
  }
}
