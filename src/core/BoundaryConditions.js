/**
 * Boundary Condition modes for the fluid dynamics simulation.
 */
export const BoundaryType = Object.freeze({
  FREE_SLIP: 'free_slip', // Zero normal velocity, tangential velocity preserved
  NO_SLIP: 'no_slip',     // Zero normal velocity, zero tangential velocity (frictional wall)
});

/**
 * Handles physical boundary conditions for Eulerian fluid grids,
 * including domain borders and arbitrary internal solid obstacles.
 */
export class BoundaryConditions {
  /**
   * Enforces velocity boundary conditions along domain borders and solid obstacles.
   * Restricts fluid penetration across all boundaries.
   * 
   * @param {FluidGrid} grid - The fluid grid instance.
   * @param {string} [type=BoundaryType.FREE_SLIP] - Boundary condition type.
   */
  static applyVelocity(grid, type = BoundaryType.FREE_SLIP) {
    const { width, height, u, v, solid } = grid;
    const isFreeSlip = type === BoundaryType.FREE_SLIP;

    // 1. Domain Borders
    // Left (x = 0) & Right (x = width - 1) boundaries
    for (let y = 0; y < height; y++) {
      const leftIdx = y * width;
      const leftNeighborIdx = leftIdx + 1;
      u[leftIdx] = 0; // No normal velocity through wall
      v[leftIdx] = isFreeSlip ? v[leftNeighborIdx] : -v[leftNeighborIdx];

      const rightIdx = y * width + (width - 1);
      const rightNeighborIdx = rightIdx - 1;
      u[rightIdx] = 0; // No normal velocity through wall
      v[rightIdx] = isFreeSlip ? v[rightNeighborIdx] : -v[rightNeighborIdx];
    }

    // Top (y = 0) & Bottom (y = height - 1) boundaries
    for (let x = 0; x < width; x++) {
      const topIdx = x;
      const topNeighborIdx = x + width;
      v[topIdx] = 0; // No normal velocity through wall
      u[topIdx] = isFreeSlip ? u[topNeighborIdx] : -u[topNeighborIdx];

      const btmIdx = x + (height - 1) * width;
      const btmNeighborIdx = x + (height - 2) * width;
      v[btmIdx] = 0; // No normal velocity through wall
      u[btmIdx] = isFreeSlip ? u[btmNeighborIdx] : -u[btmNeighborIdx];
    }

    // Corners (average adjacent boundaries)
    u[0] = 0.5 * (u[1] + u[width]);
    v[0] = 0.5 * (v[1] + v[width]);

    u[width - 1] = 0.5 * (u[width - 2] + u[2 * width - 1]);
    v[width - 1] = 0.5 * (v[width - 2] + v[2 * width - 1]);

    const btmLeft = (height - 1) * width;
    u[btmLeft] = 0.5 * (u[btmLeft + 1] + u[btmLeft - width]);
    v[btmLeft] = 0.5 * (v[btmLeft + 1] + v[btmLeft - width]);

    const btmRight = height * width - 1;
    u[btmRight] = 0.5 * (u[btmRight - 1] + u[btmRight - width]);
    v[btmRight] = 0.5 * (v[btmRight - 1] + v[btmRight - width]);

    // 2. Arbitrary Internal Solid Obstacles
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = x + y * width;
        if (solid[idx] === 1) {
          // Zero velocity inside solid
          u[idx] = 0;
          v[idx] = 0;

          // Restrict fluid movement into the solid from adjacent fluid cells
          // Cell to the left: cannot flow rightwards into solid
          const leftIdx = idx - 1;
          if (solid[leftIdx] === 0 && u[leftIdx] > 0) {
            u[leftIdx] = 0;
          }

          // Cell to the right: cannot flow leftwards into solid
          const rightIdx = idx + 1;
          if (solid[rightIdx] === 0 && u[rightIdx] < 0) {
            u[rightIdx] = 0;
          }

          // Cell above: cannot flow downwards into solid
          const topIdx = idx - width;
          if (solid[topIdx] === 0 && v[topIdx] > 0) {
            v[topIdx] = 0;
          }

          // Cell below: cannot flow upwards into solid
          const btmIdx = idx + width;
          if (solid[btmIdx] === 0 && v[btmIdx] < 0) {
            v[btmIdx] = 0;
          }
        }
      }
    }
  }

  /**
   * Applies Neumann boundary conditions (zero flux: dField/dn = 0) to a scalar field
   * (e.g. density, temperature, or pressure) so fluid matter does not escape through walls.
   * 
   * @param {FluidGrid} grid - The fluid grid instance.
   * @param {Float32Array} field - Scalar field array.
   */
  static applyScalar(grid, field) {
    const { width, height, solid } = grid;

    // Outer domain edges: copy from interior adjacent cells
    for (let y = 1; y < height - 1; y++) {
      const leftIdx = y * width;
      field[leftIdx] = field[leftIdx + 1];

      const rightIdx = y * width + (width - 1);
      field[rightIdx] = field[rightIdx - 1];
    }

    for (let x = 1; x < width - 1; x++) {
      const topIdx = x;
      field[topIdx] = field[topIdx + width];

      const btmIdx = x + (height - 1) * width;
      field[btmIdx] = field[btmIdx - width];
    }

    // Outer corners
    field[0] = 0.5 * (field[1] + field[width]);
    field[width - 1] = 0.5 * (field[width - 2] + field[2 * width - 1]);
    field[(height - 1) * width] = 0.5 * (field[(height - 1) * width + 1] + field[(height - 2) * width]);
    field[width * height - 1] = 0.5 * (field[width * height - 2] + field[width * (height - 1) - 1]);

    // Solid obstacle cells: set value to average of neighboring fluid cells
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = x + y * width;
        if (solid[idx] === 1) {
          let sum = 0;
          let count = 0;

          if (solid[idx - 1] === 0) { sum += field[idx - 1]; count++; }
          if (solid[idx + 1] === 0) { sum += field[idx + 1]; count++; }
          if (solid[idx - width] === 0) { sum += field[idx - width]; count++; }
          if (solid[idx + width] === 0) { sum += field[idx + width]; count++; }

          field[idx] = count > 0 ? sum / count : 0;
        }
      }
    }
  }

  /**
   * Applies boundary condition to a generic field according to boundary flag b.
   * Follows Stam's convention:
   * b = 1 for horizontal velocity u (reflects on left/right walls)
   * b = 2 for vertical velocity v (reflects on top/bottom walls)
   * b = 0 for scalar fields (density, pressure)
   * 
   * @param {FluidGrid} grid - The fluid grid.
   * @param {Float32Array} x - Field buffer.
   * @param {number} b - Boundary flag (0: scalar, 1: u, 2: v).
   */
  static applyStamBoundary(grid, x, b) {
    const { width, height } = grid;

    // Vertical domain borders
    for (let y = 1; y < height - 1; y++) {
      const leftIdx = y * width;
      const rightIdx = y * width + (width - 1);
      x[leftIdx] = b === 1 ? -x[leftIdx + 1] : x[leftIdx + 1];
      x[rightIdx] = b === 1 ? -x[rightIdx - 1] : x[rightIdx - 1];
    }

    // Horizontal domain borders
    for (let col = 1; col < width - 1; col++) {
      const topIdx = col;
      const btmIdx = col + (height - 1) * width;
      x[topIdx] = b === 2 ? -x[topIdx + width] : x[topIdx + width];
      x[btmIdx] = b === 2 ? -x[btmIdx - width] : x[btmIdx - width];
    }

    // Corners
    x[0] = 0.5 * (x[1] + x[width]);
    x[width - 1] = 0.5 * (x[width - 2] + x[2 * width - 1]);
    const btmLeft = (height - 1) * width;
    x[btmLeft] = 0.5 * (x[btmLeft + 1] + x[btmLeft - width]);
    const btmRight = width * height - 1;
    x[btmRight] = 0.5 * (x[btmRight - 1] + x[btmRight - width]);
  }
}
