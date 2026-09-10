import { clamp } from '../utils/MathUtils.js';
import { ColorPalette, getPaletteLUT, getPaletteLUT32, packRGBA, hsvToRgb, hsvToRgb32 } from './ColorMaps.js';

/**
 * Render modes for fluid visualization.
 */
export const RenderMode = Object.freeze({
  DENSITY: 'density',               // Scalar density field mapped to color palette
  VELOCITY: 'velocity',             // Velocity magnitude (|u,v|) mapped to color palette
  DIRECTION: 'direction',           // Flow direction (angle) mapped to HSV color wheel
  PRESSURE: 'pressure',             // Pressure field visualization
  DIVERGENCE: 'divergence',         // Divergence field visualization
});

/**
 * High-performance HTML5 2D Canvas rendering pipeline for PhySim.
 * Visualizes fluid density, velocity gradients, vectors, and solid obstacles.
 * Optimized with 32-bit pixel writes, zero-allocation loops, and batched vector draw calls.
 */
export class FluidRenderer {
  /**
   * @param {HTMLCanvasElement|Object} canvas - HTML5 canvas or canvas-like object.
   * @param {FluidSimulation} simulation - Fluid simulation instance.
   * @param {Object} [options={}] - Renderer options.
   * @param {string} [options.renderMode=RenderMode.DENSITY] - Initial render mode.
   * @param {string} [options.colorPalette=ColorPalette.FIRE] - Color palette.
   * @param {boolean} [options.showVectors=false] - Whether to overlay velocity arrows.
   * @param {number} [options.vectorSpacing=4] - Grid cell interval for vector arrows.
   * @param {number} [options.vectorScale=1.2] - Velocity vector visual scale.
   * @param {boolean} [options.showObstacles=true] - Whether to render solid obstacles.
   * @param {number} [options.maxDensityScale=50.0] - Reference max density for color mapping.
   * @param {number} [options.maxSpeedScale=30.0] - Reference max speed for color mapping.
   * @param {boolean} [options.smoothScaling=true] - Enable bilinear smoothing when upscaling to canvas.
   */
  constructor(canvas, simulation, options = {}) {
    if (!canvas) {
      throw new Error('FluidRenderer requires a valid canvas element.');
    }
    if (!simulation) {
      throw new Error('FluidRenderer requires a valid FluidSimulation instance.');
    }

    this.canvas = canvas;
    this.simulation = simulation;
    this.ctx = canvas.getContext ? canvas.getContext('2d') : null;

    const dims = simulation.getDimensions();
    this.gridWidth = dims.width;
    this.gridHeight = dims.height;

    this.renderMode = options.renderMode ?? RenderMode.DENSITY;
    this.colorPalette = options.colorPalette ?? ColorPalette.FIRE;
    this.showVectors = options.showVectors ?? false;
    this.vectorSpacing = Math.max(1, options.vectorSpacing ?? 4);
    this.vectorScale = options.vectorScale ?? 1.2;
    this.showObstacles = options.showObstacles ?? true;
    this.maxDensityScale = options.maxDensityScale ?? 50.0;
    this.maxSpeedScale = options.maxSpeedScale ?? 30.0;
    this.smoothScaling = options.smoothScaling ?? true;

    // Solid obstacle styling (precomputed 8-bit and 32-bit)
    this.obstacleColor = [40, 46, 60, 255];       // Dark slate
    this.boundaryWallColor = [25, 28, 38, 255];   // Deep border
    this.obstacleColor32 = packRGBA(40, 46, 60, 255);
    this.boundaryWallColor32 = packRGBA(25, 28, 38, 255);
    this.directionDarkColor32 = packRGBA(10, 12, 18, 255);

    // Create offscreen buffer canvas matching grid resolution for fast rasterization
    this._initOffscreenBuffer();
  }

  /**
   * Initializes internal offscreen canvas and pixel data buffer.
   * @private
   */
  _initOffscreenBuffer() {
    this.offscreenCanvas = this._createCanvas(this.gridWidth, this.gridHeight);
    this.offscreenCtx = this.offscreenCanvas.getContext ? this.offscreenCanvas.getContext('2d') : null;

    if (typeof ImageData !== 'undefined') {
      this.imageData = new ImageData(this.gridWidth, this.gridHeight);
    } else {
      // Fallback for headless/Node.js testing environments
      this.imageData = {
        width: this.gridWidth,
        height: this.gridHeight,
        data: new Uint8ClampedArray(this.gridWidth * this.gridHeight * 4),
      };
    }
    this.pixels = this.imageData.data;
    this.pixels32 = (this.imageData.data && this.imageData.data.buffer)
      ? new Uint32Array(this.imageData.data.buffer)
      : null;
  }

  /**
   * Creates a canvas element or mock in headless environments.
   * @private
   */
  _createCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(w, h);
    }
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    // Headless / mock canvas
    return {
      width: w,
      height: h,
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
    };
  }

  /**
   * Sets visualization render mode.
   * @param {string} mode - One of RenderMode values.
   */
  setRenderMode(mode) {
    this.renderMode = mode;
  }

  /**
   * Sets color palette for scalar field and velocity gradient rendering.
   * @param {string} palette - One of ColorPalette values.
   */
  setColorPalette(palette) {
    this.colorPalette = palette;
  }

  /**
   * Toggles velocity vector overlay.
   * @param {boolean} show - Whether vectors should be rendered.
   */
  setShowVectors(show) {
    this.showVectors = Boolean(show);
  }

  /**
   * Sets density normalization scale.
   * @param {number} scale - Peak expected density value.
   */
  setMaxDensityScale(scale) {
    this.maxDensityScale = Math.max(0.1, Number(scale));
  }

  /**
   * Sets velocity speed normalization scale.
   * @param {number} scale - Peak expected velocity speed.
   */
  setMaxSpeedScale(scale) {
    this.maxSpeedScale = Math.max(0.1, Number(scale));
  }

  /**
   * Sets whether bilinear texture smoothing is used when scaling to canvas.
   * @param {boolean} enabled
   */
  setSmoothScaling(enabled) {
    this.smoothScaling = Boolean(enabled);
  }

  /**
   * Automatically adapts canvas internal buffer size to match its CSS display size
   * and high-DPI device pixel ratio across standard viewports.
   * 
   * @param {number} [pixelRatio] - Device pixel ratio (defaults to window.devicePixelRatio or 1).
   * @returns {boolean} True if the canvas dimensions were changed.
   */
  resizeToDisplaySize(pixelRatio) {
    if (!this.canvas) return false;

    const dpr = pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const displayWidth = Math.floor((this.canvas.clientWidth || this.canvas.width || 512) * dpr);
    const displayHeight = Math.floor((this.canvas.clientHeight || this.canvas.height || 512) * dpr);

    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
      return true;
    }
    return false;
  }

  /**
   * Explicitly resizes canvas buffer to specified pixel dimensions.
   * @param {number} width - New pixel width.
   * @param {number} height - New pixel height.
   */
  resize(width, height) {
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.floor(width));
      this.canvas.height = Math.max(1, Math.floor(height));
    }
  }

  /**
   * Maps client/screen coordinates to canvas pixel space.
   * Accepts optional `out` object to avoid memory allocation.
   * 
   * @param {number} clientX - Screen X position.
   * @param {number} clientY - Screen Y position.
   * @param {Object} [out=null] - Optional output object to receive {x, y}.
   * @returns {{ x: number, y: number }} Canvas pixel coordinates.
   */
  clientToCanvas(clientX, clientY, out = null) {
    const res = out || { x: 0, y: 0 };
    if (!this.canvas || !this.canvas.getBoundingClientRect) {
      res.x = 0;
      res.y = 0;
      return res;
    }

    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;

    const normalizedX = (clientX - rect.left) / width;
    const normalizedY = (clientY - rect.top) / height;

    const canvasWidth = this.canvas.width || width;
    const canvasHeight = this.canvas.height || height;

    res.x = clamp(normalizedX * canvasWidth, 0, canvasWidth);
    res.y = clamp(normalizedY * canvasHeight, 0, canvasHeight);

    return res;
  }

  /**
   * Maps canvas coordinates to discrete/continuous simulation grid cell coordinates.
   * Accepts optional `out` object to avoid memory allocation.
   * 
   * @param {number} canvasX - Canvas X position.
   * @param {number} canvasY - Canvas Y position.
   * @param {Object} [out=null] - Optional output object to receive {x, y}.
   * @returns {{ x: number, y: number }} Grid coordinates in cell units.
   */
  canvasToGrid(canvasX, canvasY, out = null) {
    const res = out || { x: 0, y: 0 };
    const canvasWidth = this.canvas ? (this.canvas.width || 1) : 1;
    const canvasHeight = this.canvas ? (this.canvas.height || 1) : 1;

    res.x = clamp((canvasX / canvasWidth) * this.gridWidth, 0, this.gridWidth - 1);
    res.y = clamp((canvasY / canvasHeight) * this.gridHeight, 0, this.gridHeight - 1);

    return res;
  }

  /**
   * Maps grid coordinates to canvas coordinates.
   * Accepts optional `out` object to avoid memory allocation.
   * 
   * @param {number} gridX - Grid X position.
   * @param {number} gridY - Grid Y position.
   * @param {Object} [out=null] - Optional output object to receive {x, y}.
   * @returns {{ x: number, y: number }} Canvas coordinates.
   */
  gridToCanvas(gridX, gridY, out = null) {
    const res = out || { x: 0, y: 0 };
    const canvasWidth = this.canvas ? (this.canvas.width || 1) : 1;
    const canvasHeight = this.canvas ? (this.canvas.height || 1) : 1;

    res.x = (gridX / this.gridWidth) * canvasWidth;
    res.y = (gridY / this.gridHeight) * canvasHeight;

    return res;
  }

  /**
   * Maps client/screen coordinates to simulation grid cell coordinates.
   * Accepts optional `out` object to avoid memory allocation.
   * 
   * @param {number} clientX - Screen X position.
   * @param {number} clientY - Screen Y position.
   * @param {Object} [out=null] - Optional output object to receive {x, y}.
   * @returns {{ x: number, y: number }} Grid coordinates in cell units.
   */
  clientToGrid(clientX, clientY, out = null) {
    const res = out || { x: 0, y: 0 };
    if (!this.canvas || !this.canvas.getBoundingClientRect) {
      res.x = 0;
      res.y = 0;
      return res;
    }

    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;

    const normalizedX = (clientX - rect.left) / width;
    const normalizedY = (clientY - rect.top) / height;

    res.x = clamp(normalizedX * this.gridWidth, 0, this.gridWidth - 1);
    res.y = clamp(normalizedY * this.gridHeight, 0, this.gridHeight - 1);

    return res;
  }

  /**
   * Primary rendering pipeline step.
   * Rasterizes simulation buffers using fast 32-bit pixel stores,
   * scales to canvas viewport without redundant clearRect calls, and batches vector glyphs.
   */
  render() {
    const { gridWidth, gridHeight, simulation, pixels, pixels32, renderMode, colorPalette } = this;
    const density = simulation.getDensityBuffer();
    const { u, v } = simulation.getVelocityBuffers();
    const solid = simulation.getObstacleBuffer();
    const pressure = simulation.getPressureBuffer();
    const divergence = simulation.getDivergenceBuffer();

    const invDensityScale = 1.0 / this.maxDensityScale;
    const invSpeedScale = 1.0 / this.maxSpeedScale;
    const invTwoPi = 1.0 / (2 * Math.PI);

    // Fast path: use 32-bit integer writes when Uint32Array view is available
    if (pixels32) {
      const lut32 = getPaletteLUT32(colorPalette);
      const { obstacleColor32, boundaryWallColor32, directionDarkColor32 } = this;

      for (let y = 0; y < gridHeight; y++) {
        const row = y * gridWidth;
        for (let x = 0; x < gridWidth; x++) {
          const idx = row + x;

          // Render solid obstacles and boundary walls
          if (this.showObstacles && solid[idx] === 1) {
            const isBorder = (x === 0 || x === gridWidth - 1 || y === 0 || y === gridHeight - 1);
            pixels32[idx] = isBorder ? boundaryWallColor32 : obstacleColor32;
            continue;
          }

          switch (renderMode) {
            case RenderMode.DENSITY: {
              const d = density[idx];
              const t = clamp(d * invDensityScale, 0.0, 1.0);
              pixels32[idx] = lut32[(t * 255) | 0];
              break;
            }

            case RenderMode.VELOCITY: {
              const velU = u[idx];
              const velV = v[idx];
              const speed = Math.hypot(velU, velV);
              const t = clamp(speed * invSpeedScale, 0.0, 1.0);
              pixels32[idx] = lut32[(t * 255) | 0];
              break;
            }

            case RenderMode.DIRECTION: {
              const velU = u[idx];
              const velV = v[idx];
              const speed = Math.hypot(velU, velV);
              if (speed < 0.01) {
                pixels32[idx] = directionDarkColor32;
              } else {
                const angle = Math.atan2(velV, velU);
                const hue = (angle + Math.PI) * invTwoPi;
                const val = clamp(speed * invSpeedScale, 0.2, 1.0);
                pixels32[idx] = hsvToRgb32(hue, 0.95, val);
              }
              break;
            }

            case RenderMode.PRESSURE: {
              const p = pressure[idx];
              const t = clamp((p + 1.0) * 0.5, 0.0, 1.0);
              pixels32[idx] = lut32[(t * 255) | 0];
              break;
            }

            case RenderMode.DIVERGENCE: {
              const div = Math.abs(divergence[idx]);
              const t = clamp(div * 5.0, 0.0, 1.0);
              pixels32[idx] = lut32[(t * 255) | 0];
              break;
            }

            default: {
              const d = density[idx];
              const t = clamp(d * invDensityScale, 0.0, 1.0);
              pixels32[idx] = lut32[(t * 255) | 0];
              break;
            }
          }
        }
      }
    } else {
      // 8-bit fallback path for mock or custom environments
      const lut = getPaletteLUT(colorPalette);
      let pixelOffset = 0;

      for (let y = 0; y < gridHeight; y++) {
        const row = y * gridWidth;
        for (let x = 0; x < gridWidth; x++) {
          const idx = row + x;

          if (this.showObstacles && solid[idx] === 1) {
            const isBorder = (x === 0 || x === gridWidth - 1 || y === 0 || y === gridHeight - 1);
            const col = isBorder ? this.boundaryWallColor : this.obstacleColor;
            pixels[pixelOffset] = col[0];
            pixels[pixelOffset + 1] = col[1];
            pixels[pixelOffset + 2] = col[2];
            pixels[pixelOffset + 3] = col[3];
            pixelOffset += 4;
            continue;
          }

          let r = 0;
          let g = 0;
          let b = 0;
          let a = 255;

          switch (renderMode) {
            case RenderMode.DENSITY: {
              const d = density[idx];
              const t = clamp(d * invDensityScale, 0.0, 1.0);
              const lutOffset = ((t * 255) | 0) * 4;
              r = lut[lutOffset];
              g = lut[lutOffset + 1];
              b = lut[lutOffset + 2];
              break;
            }

            case RenderMode.VELOCITY: {
              const velU = u[idx];
              const velV = v[idx];
              const speed = Math.hypot(velU, velV);
              const t = clamp(speed * invSpeedScale, 0.0, 1.0);
              const lutOffset = ((t * 255) | 0) * 4;
              r = lut[lutOffset];
              g = lut[lutOffset + 1];
              b = lut[lutOffset + 2];
              break;
            }

            case RenderMode.DIRECTION: {
              const velU = u[idx];
              const velV = v[idx];
              const speed = Math.hypot(velU, velV);
              if (speed < 0.01) {
                r = 10; g = 12; b = 18;
              } else {
                const angle = Math.atan2(velV, velU);
                const hue = (angle + Math.PI) * invTwoPi;
                const val = clamp(speed * invSpeedScale, 0.2, 1.0);
                const rgb = hsvToRgb(hue, 0.95, val);
                r = rgb[0];
                g = rgb[1];
                b = rgb[2];
              }
              break;
            }

            case RenderMode.PRESSURE: {
              const p = pressure[idx];
              const t = clamp((p + 1.0) * 0.5, 0.0, 1.0);
              const lutOffset = ((t * 255) | 0) * 4;
              r = lut[lutOffset];
              g = lut[lutOffset + 1];
              b = lut[lutOffset + 2];
              break;
            }

            case RenderMode.DIVERGENCE: {
              const div = Math.abs(divergence[idx]);
              const t = clamp(div * 5.0, 0.0, 1.0);
              const lutOffset = ((t * 255) | 0) * 4;
              r = lut[lutOffset];
              g = lut[lutOffset + 1];
              b = lut[lutOffset + 2];
              break;
            }

            default: {
              const d = density[idx];
              const t = clamp(d * invDensityScale, 0.0, 1.0);
              const lutOffset = ((t * 255) | 0) * 4;
              r = lut[lutOffset];
              g = lut[lutOffset + 1];
              b = lut[lutOffset + 2];
              break;
            }
          }

          pixels[pixelOffset] = r;
          pixels[pixelOffset + 1] = g;
          pixels[pixelOffset + 2] = b;
          pixels[pixelOffset + 3] = a;
          pixelOffset += 4;
        }
      }
    }

    // 2. Put pixel data onto offscreen canvas
    if (this.offscreenCtx && this.offscreenCtx.putImageData) {
      this.offscreenCtx.putImageData(this.imageData, 0, 0);
    }

    // 3. Draw scaled offscreen canvas onto primary canvas
    // Note: Since offscreen canvas is completely opaque (alpha=255) and matches canvas dimensions,
    // drawImage completely overwrites the target canvas area, avoiding redundant clearRect overhead.
    const { ctx, canvas } = this;
    if (!ctx) return;

    ctx.imageSmoothingEnabled = this.smoothScaling;
    ctx.drawImage(this.offscreenCanvas, 0, 0, canvas.width, canvas.height);

    // 4. Render velocity vector arrows overlay if enabled
    if (this.showVectors) {
      this._renderVelocityVectors(ctx, canvas.width, canvas.height, u, v, solid);
    }
  }

  /**
   * Overlays discrete velocity vector arrows across the fluid grid.
   * Batches arrow shafts into a single path and arrowheads into a single path
   * to minimize canvas draw calls and state changes.
   * @private
   */
  _renderVelocityVectors(ctx, canvasW, canvasH, u, v, solid) {
    const { gridWidth, gridHeight, vectorSpacing, vectorScale, maxSpeedScale } = this;
    const cellW = canvasW / gridWidth;
    const cellH = canvasH / gridHeight;
    const maxArrowLen = Math.min(cellW, cellH) * (vectorSpacing * 0.9);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = Math.max(1, canvasW / 400);

    // Batch 1: All arrow stems drawn in one continuous path
    let hasVectors = false;
    ctx.beginPath();

    for (let y = vectorSpacing; y < gridHeight - 1; y += vectorSpacing) {
      const row = y * gridWidth;
      for (let x = vectorSpacing; x < gridWidth - 1; x += vectorSpacing) {
        const idx = row + x;
        if (solid[idx] === 1) continue;

        const velU = u[idx];
        const velV = v[idx];
        const speed = Math.hypot(velU, velV);
        if (speed < 0.2) continue;

        hasVectors = true;
        const centerX = (x + 0.5) * cellW;
        const centerY = (y + 0.5) * cellH;

        const length = Math.min(maxArrowLen, (speed / maxSpeedScale) * maxArrowLen * vectorScale * 2.0);
        const dirX = velU / speed;
        const dirY = velV / speed;

        const endX = centerX + dirX * length;
        const endY = centerY + dirY * length;

        ctx.moveTo(centerX, centerY);
        ctx.lineTo(endX, endY);
      }
    }

    if (hasVectors) {
      ctx.stroke();

      // Batch 2: All arrowheads drawn in one continuous path and filled once
      ctx.beginPath();
      for (let y = vectorSpacing; y < gridHeight - 1; y += vectorSpacing) {
        const row = y * gridWidth;
        for (let x = vectorSpacing; x < gridWidth - 1; x += vectorSpacing) {
          const idx = row + x;
          if (solid[idx] === 1) continue;

          const velU = u[idx];
          const velV = v[idx];
          const speed = Math.hypot(velU, velV);
          if (speed < 0.2) continue;

          const centerX = (x + 0.5) * cellW;
          const centerY = (y + 0.5) * cellH;

          const length = Math.min(maxArrowLen, (speed / maxSpeedScale) * maxArrowLen * vectorScale * 2.0);
          const dirX = velU / speed;
          const dirY = velV / speed;

          const endX = centerX + dirX * length;
          const endY = centerY + dirY * length;

          const headSize = Math.max(3, length * 0.3);
          const perpX = -dirY * headSize * 0.5;
          const perpY = dirX * headSize * 0.5;

          ctx.moveTo(endX, endY);
          ctx.lineTo(endX - dirX * headSize + perpX, endY - dirY * headSize + perpY);
          ctx.lineTo(endX - dirX * headSize - perpX, endY - dirY * headSize - perpY);
          ctx.closePath();
        }
      }
      ctx.fill();
    }

    ctx.restore();
  }
}
