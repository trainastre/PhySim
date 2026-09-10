# PhySim - 2D Fluid Simulation Engine

PhySim is a high-performance, modular 2D fluid dynamics engine implemented in JavaScript. It solves the incompressible Navier-Stokes equations using Eulerian grid-based techniques (Jos Stam's Stable Fluids formulation) with Gauss-Seidel pressure projection, semi-Lagrangian advection, and arbitrary solid boundary condition support.

## Key Features

* **Eulerian Grid-Based Navier-Stokes Solver**: Accurately computes velocity (`u`, `v`), pressure (`p`), and scalar density fields per time step.
* **Unconditionally Stable Advection**: Semi-Lagrangian backtracing guarantees that the fluid solver never diverges or blows up numerically, even under high velocities or large time steps.
* **Incompressible Flow (Divergence-Free Projection)**: Helmholtz-Hodge decomposition solves the Poisson equation for pressure ($\nabla^2 p = \nabla \cdot \mathbf{u}^*$) using iterative Gauss-Seidel relaxation to enforce mass conservation ($\nabla \cdot \mathbf{u} = 0$).
* **Flexible Boundary Conditions**:
  * Free-slip and no-slip domain wall boundaries.
  * Solid internal obstacles (boxes, circles, arbitrary shapes) with zero-penetration and Neumann scalar/pressure conditions.
* **Decoupled Engine Architecture**: Fully headless core engine with zero DOM, Canvas, or WebGL dependencies. Compatible with Node.js, Web Workers, and browser environments.

## Architecture

```
PhySim/
├── src/
│   ├── index.js                     # Main entry point & API exports
│   ├── core/
│   │   ├── FluidGrid.js             # Contiguous Float32Array grid memory
│   │   ├── FluidSolver.js           # Navier-Stokes physics solver (advect, diffuse, project)
│   │   ├── FluidSimulation.js       # High-level simulation engine & interaction layer
│   │   ├── BoundaryConditions.js    # Edge and solid obstacle boundary solvers
│   │   └── Advection.js             # Semi-Lagrangian advection and interpolation
│   └── utils/
│       └── MathUtils.js             # Clamping, lerp, and bilinear sampling
├── test/
│   ├── FluidSolver.test.js          # Numerical stability, convergence, and field tests
│   ├── BoundaryConditions.test.js   # Wall restriction, obstacle collision tests
│   └── run-tests.js                 # Standalone test runner
└── examples/
    └── headless-simulation.js       # Headless usage example
```

## Quick Start

### Installation

No external dependencies are required. Pure ES Modules for Node.js or modern browsers.

```bash
git clone <repo-url>
cd PhySim
```

### Running Tests

```bash
npm test
# or
node test/run-tests.js
```

### Running the Headless Example

```bash
node examples/headless-simulation.js
```

### Basic Usage

```javascript
import { FluidSimulation } from 'physim';

// 1. Initialize simulation grid
const sim = new FluidSimulation({
  width: 64,
  height: 64,
  viscosity: 0.0001,
  diffusion: 0.00001,
  solverIterations: 25,
});

// 2. Add an obstacle
sim.setObstacleCircle(32, 32, 6, true);

// 3. Inject density (smoke/dye) and velocity impulse
sim.addDensitySplat(32, 50, 5, 80.0);
sim.addVelocityImpulse(32, 50, 5, 0, -25.0); // push upwards towards obstacle

// 4. Advance physics independently of any rendering
const dt = 0.016; // 60 FPS
sim.step(dt);

// 5. Access raw Float32Array buffers for custom renderers (Canvas2D, WebGL, etc.)
const densityBuffer = sim.getDensityBuffer();
const { u, v } = sim.getVelocityBuffers();
const pressureBuffer = sim.getPressureBuffer();
const obstacles = sim.getObstacleBuffer();

// 6. Inspect physical diagnostics
const stats = sim.getDiagnostics();
console.log(`Max divergence: ${stats.maxDivergence}, Max speed: ${stats.maxSpeed}`);
```

## Physics & Numerical Methods

### 1. Momentum & Advection (Semi-Lagrangian)
$$\frac{\partial \mathbf{u}}{\partial t} = -(\mathbf{u} \cdot \nabla)\mathbf{u} - \frac{1}{\rho}\nabla p + \nu \nabla^2 \mathbf{u} + \mathbf{f}$$

Advection is integrated backwards in time:
$$\mathbf{x}_{\text{back}} = \mathbf{x} - \Delta t \cdot \mathbf{u}(\mathbf{x})$$
The advected quantity is evaluated at $\mathbf{x}_{\text{back}}$ using bilinear spatial interpolation. Because bilinear interpolation is a convex combination of surrounding cells, the advected field is guaranteed to remain bounded by the minimum and maximum of the initial field, preventing any numerical divergence.

### 2. Incompressibility & Pressure Projection
Mass conservation requires:
$$\nabla \cdot \mathbf{u} = 0$$
Any divergent velocity field $\mathbf{u}^*$ is decomposed via Helmholtz-Hodge decomposition into a divergence-free component $\mathbf{u}$ and the gradient of a scalar pressure field $\nabla p$:
$$\nabla^2 p = \nabla \cdot \mathbf{u}^*$$
$$\mathbf{u} = \mathbf{u}^* - \nabla p$$
The Poisson equation is solved efficiently using Gauss-Seidel relaxation with boundary reflection conditions.

### 3. Boundary Conditions
* **Solid Domain Walls**: Normal velocity component $u_n = 0$ prevents fluid from leaving the domain.
* **Internal Obstacles**: Velocities on obstacle cells are set to zero, and fluid cells adjacent to walls have penetrating velocities blocked.
* **Neumann Condition for Scalars**: Density and pressure have zero normal gradient ($\partial \phi / \partial n = 0$) across walls to conserve total fluid mass.

## License

MIT
