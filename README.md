# PhySim - 2D Fluid Simulation Engine

PhySim is a high-performance, modular 2D fluid dynamics engine implemented in JavaScript. It solves the incompressible Navier-Stokes equations using Eulerian grid-based techniques (Jos Stam's Stable Fluids formulation) with Gauss-Seidel pressure projection, semi-Lagrangian advection, arbitrary solid boundary condition support, and an interactive real-time HTML5 Canvas rendering pipeline.

## Key Features

* **Eulerian Grid-Based Navier-Stokes Solver**: Accurately computes velocity (`u`, `v`), pressure (`p`), and scalar density fields per time step.
* **Unconditionally Stable Advection**: Semi-Lagrangian backtracing guarantees that the fluid solver never diverges or blows up numerically, even under high velocities or large time steps.
* **Incompressible Flow (Divergence-Free Projection)**: Helmholtz-Hodge decomposition solves the Poisson equation for pressure ($\nabla^2 p = \nabla \cdot \mathbf{u}^*$) using iterative Gauss-Seidel relaxation to enforce mass conservation ($\nabla \cdot \mathbf{u} = 0$).
* **Flexible Boundary Conditions**:
  * Free-slip and no-slip domain wall boundaries.
  * Solid internal obstacles (boxes, circles, arbitrary shapes) with zero-penetration and Neumann scalar/pressure conditions.
* **Real-Time HTML5 Canvas Rendering Pipeline**:
  * Offscreen buffer rasterization with hardware-accelerated bilinear upscaling.
  * Responsive viewport scaling across desktop, tablet, and mobile displays.
  * Multi-palette color mapping (Fire, Ocean Cyan, Turbo Spectrum, Inferno, Neon, Greyscale).
  * Multiple render modes: Fluid Density, Velocity Speed Gradient, 360° Flow Direction Wheel, Pressure, and Divergence.
  * Vector glyph overlay for visualizing flow streamlines.
* **Interactive Web Interface**:
  * Sliders for modifying core parameters instantly (Viscosity, Gravity / Buoyancy, Density Dissipation, Diffusion, Vorticity, Solver Iterations).
  * Direct mouse and multi-touch gestures (Pointer Events) to draw fluid, inject momentum impulses, or build solid obstacles.
  * Dynamic drag speed force scaling: faster dragging applies proportionally larger velocity force vectors with zero-lag response.
  * Built-in physics presets: Smoke Plume, Karman Vortex Street, Swirling Vortices, Zero-G Expansion.
* **Decoupled Engine Architecture**: Fully headless core engine with zero mandatory DOM dependencies. Compatible with Node.js, Web Workers, and browser environments.

## Architecture

```
PhySim/
├── index.html                       # HTML5 Interactive Web Application
├── src/
│   ├── index.js                     # Main entry point & API exports
│   ├── core/
│   │   ├── FluidGrid.js             # Contiguous Float32Array grid memory
│   │   ├── FluidSolver.js           # Navier-Stokes physics solver (advect, diffuse, project, dissipate)
│   │   ├── FluidSimulation.js       # High-level simulation engine & interaction layer
│   │   ├── BoundaryConditions.js    # Edge and solid obstacle boundary solvers
│   │   └── Advection.js             # Semi-Lagrangian advection and interpolation
│   ├── rendering/
│   │   ├── FluidRenderer.js         # Real-time HTML5 2D Canvas rendering pipeline
│   │   ├── ColorMaps.js             # Precomputed 256-entry RGBA LUT palettes & HSV conversion
│   │   └── index.js                 # Renderer exports
│   ├── ui/
│   │   ├── app.js                   # Web application controller, event listeners & presets
│   │   ├── PointerController.js     # Responsive mouse, touch & pointer interaction controller
│   │   └── style.css                # Responsive glassmorphic layout & viewport styling
│   └── utils/
│       └── MathUtils.js             # Clamping, lerp, and bilinear sampling
├── test/
│   ├── FluidSolver.test.js          # Numerical stability, convergence, and field tests
│   ├── BoundaryConditions.test.js   # Wall restriction, obstacle collision tests
│   ├── FluidRenderer.test.js        # Rendering pipeline, color mapping, and scaling tests
│   ├── PointerController.test.js    # Mouse & multi-touch pointer gesture and drag speed tests
│   └── run-tests.js                 # Node.js standalone test runner
├── tests/
│   └── test_physim.py               # Python/pytest test integration
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

### Launching the Web Interface

Open `index.html` directly in any modern browser, or start a local static server:

```bash
# Using Python
python -m http.server 8000

# Or using Node.js
npx serve .
```
Navigate to `http://localhost:8000` to interact with the fluid simulation in real time.

### Running Tests

```bash
pytest tests/
# or
node test/run-tests.js
```

### Running the Headless Example

```bash
node examples/headless-simulation.js
```

## Usage Example

### Headless Physics Simulation

```javascript
import { FluidSimulation } from './src/index.js';

// 1. Initialize simulation grid with core parameters
const sim = new FluidSimulation({
  width: 64,
  height: 64,
  viscosity: 0.0001,
  diffusion: 0.00001,
  densityDissipation: 0.005,
  gravityY: -9.8, // Buoyancy
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

// 5. Access raw Float32Array buffers for custom renderers
const densityBuffer = sim.getDensityBuffer();
const { u, v } = sim.getVelocityBuffers();
const obstacles = sim.getObstacleBuffer();
```

### Canvas Rendering Pipeline

```javascript
import { FluidSimulation, FluidRenderer, RenderMode, ColorPalette } from './src/index.js';

const canvas = document.getElementById('fluid-canvas');
const sim = new FluidSimulation({ width: 64, height: 64 });
const renderer = new FluidRenderer(canvas, sim, {
  renderMode: RenderMode.VELOCITY, // Visualizes velocity speed gradients
  colorPalette: ColorPalette.TURBO,
  showVectors: true,
});

// Real-time loop
function animate() {
  sim.step(0.016);
  renderer.render();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Instant dynamic adjustments
sim.viscosity = 0.002;
sim.densityDissipation = 0.01;
sim.gravityY = 9.8;
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

### 3. Density Dissipation
$$\frac{\partial \rho}{\partial t} = -\lambda \rho \implies \rho(t + \Delta t) = \rho(t) e^{-\lambda \Delta t}$$
Allows fluid smoke/dye to naturally dissipate over time according to user-selected dissipation rates.

### 4. Boundary Conditions
* **Solid Domain Walls**: Normal velocity component $u_n = 0$ prevents fluid from leaving the domain.
* **Internal Obstacles**: Velocities on obstacle cells are set to zero, and fluid cells adjacent to walls have penetrating velocities blocked.
* **Neumann Condition for Scalars**: Density and pressure have zero normal gradient ($\partial \phi / \partial n = 0$) across walls to conserve total fluid mass.

## License

MIT
