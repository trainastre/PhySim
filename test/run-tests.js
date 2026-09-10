import assert from 'node:assert';
import { runFluidSolverTests } from './FluidSolver.test.js';
import { runBoundaryConditionsTests } from './BoundaryConditions.test.js';
import { runFluidRendererTests } from './FluidRenderer.test.js';

console.log('==========================================');
console.log('PhySim - Core Fluid Dynamics & Rendering Tests');
console.log('==========================================\n');

try {
  runFluidSolverTests(assert);
  console.log('');
  runBoundaryConditionsTests(assert);
  console.log('');
  runFluidRendererTests(assert);

  console.log('\n==========================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY! (100% OK)');
  console.log('==========================================');
} catch (error) {
  console.error('\nTEST FAILED!');
  console.error(error);
  process.exit(1);
}
