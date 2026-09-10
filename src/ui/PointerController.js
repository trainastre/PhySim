import { clamp } from '../utils/MathUtils.js';

/**
 * High-performance, responsive pointer and touch interaction controller.
 * Handles mouse, stylus, and multi-touch gestures on the simulation canvas.
 * 
 * Features:
 * - Accurate coordinate mapping from client space to canvas space and grid cells.
 * - Dynamic dragging speed calculation determining applied velocity force vector magnitude.
 * - Minimal input lag with immediate physics injection and browser event throttling avoidance.
 * - Seamless multi-touch and pointer capture support.
 * - Stroke path interpolation for fast sweeping gestures without droplet gaps.
 */
export class PointerController {
  /**
   * @param {Object} options
   * @param {HTMLCanvasElement|Object} options.canvas - Target canvas element.
   * @param {FluidSimulation} options.simulation - Fluid simulation instance.
   * @param {FluidRenderer} options.renderer - Fluid renderer instance for coordinate mapping.
   * @param {string} [options.activeTool='fluid'] - Tool mode ('fluid'|'velocity'|'obstacle'|'erase').
   * @param {number} [options.brushRadius=3.5] - Interaction radius in grid cells.
   * @param {number} [options.densityAmount=60.0] - Fluid density amount per injection.
   * @param {number} [options.forceScale=0.8] - Multiplier scaling drag speed to applied force vector magnitude.
   * @param {number} [options.maxForce=150.0] - Maximum clamping limit for applied force vectors.
   * @param {number} [options.minSpeedThreshold=0.2] - Minimum speed threshold to apply force.
   * @param {boolean} [options.interpolate=true] - Whether to interpolate points during fast drags.
   */
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.simulation = options.simulation;
    this.renderer = options.renderer;

    this.activeTool = options.activeTool ?? 'fluid';
    this.brushRadius = options.brushRadius ?? 3.5;
    this.densityAmount = options.densityAmount ?? 60.0;
    this.forceScale = options.forceScale ?? 0.8;
    this.maxForce = options.maxForce ?? 150.0;
    this.minSpeedThreshold = options.minSpeedThreshold ?? 0.2;
    this.interpolate = options.interpolate ?? true;

    // Active pointers map: pointerId -> pointerState
    this.activePointers = new Map();

    // Diagnostics / telemetry
    this.lastAppliedForce = 0;
    this.lastDragSpeed = 0;

    this._boundHandlers = null;

    if (this.canvas) {
      this.attach();
    }
  }

  get isPointerDown() {
    return this.activePointers.size > 0;
  }

  getActivePointerCount() {
    return this.activePointers.size;
  }

  getPointerState(id) {
    return this.activePointers.get(id);
  }

  setActiveTool(tool) {
    this.activeTool = tool;
  }

  setBrushRadius(radius) {
    this.brushRadius = Math.max(0.5, Number(radius));
  }

  setDensityAmount(amount) {
    this.densityAmount = Math.max(0, Number(amount));
  }

  setForceScale(scale) {
    this.forceScale = Math.max(0, Number(scale));
  }

  setMaxForce(max) {
    this.maxForce = Math.max(1, Number(max));
  }

  /**
   * Maps screen viewport coordinates to canvas pixel space.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  clientToCanvas(clientX, clientY) {
    if (this.renderer && typeof this.renderer.clientToCanvas === 'function') {
      return this.renderer.clientToCanvas(clientX, clientY);
    }
    if (!this.canvas || !this.canvas.getBoundingClientRect) {
      return { x: 0, y: 0 };
    }
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = (this.canvas.width || rect.width || 1) / (rect.width || 1);
    const scaleY = (this.canvas.height || rect.height || 1) / (rect.height || 1);
    const x = clamp((clientX - rect.left) * scaleX, 0, this.canvas.width || rect.width);
    const y = clamp((clientY - rect.top) * scaleY, 0, this.canvas.height || rect.height);
    return { x, y };
  }

  /**
   * Maps screen viewport coordinates to simulation grid cells.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  clientToGrid(clientX, clientY) {
    if (this.renderer && typeof this.renderer.clientToGrid === 'function') {
      return this.renderer.clientToGrid(clientX, clientY);
    }
    const dims = this.simulation ? this.simulation.getDimensions() : { width: 64, height: 64 };
    if (!this.canvas || !this.canvas.getBoundingClientRect) {
      return { x: 0, y: 0 };
    }
    const rect = this.canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / (rect.width || 1);
    const ny = (clientY - rect.top) / (rect.height || 1);
    return {
      x: clamp(nx * dims.width, 0, dims.width - 1),
      y: clamp(ny * dims.height, 0, dims.height - 1),
    };
  }

  /**
   * Handles pointer activation (mouse down / touch start).
   * Injects initial mass or sets obstacle immediately with zero latency.
   * 
   * @param {number|string} id - Pointer identifier.
   * @param {number} clientX - Screen X position.
   * @param {number} clientY - Screen Y position.
   * @param {number} [time] - Timestamp in ms.
   * @returns {Object} Pointer state at start.
   */
  handlePointerStart(id, clientX, clientY, time) {
    const now = time ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const canvasPos = this.clientToCanvas(clientX, clientY);
    const gridPos = this.clientToGrid(clientX, clientY);

    const pointerState = {
      id,
      startX: clientX,
      startY: clientY,
      lastClientX: clientX,
      lastClientY: clientY,
      lastCanvasX: canvasPos.x,
      lastCanvasY: canvasPos.y,
      lastGridX: gridPos.x,
      lastGridY: gridPos.y,
      lastTime: now,
      speed: 0,
      forceMagnitude: 0,
      forceX: 0,
      forceY: 0,
    };

    this.activePointers.set(id, pointerState);

    // Splat mass immediately on contact for zero-lag tactile feedback
    this.applyInteraction(gridPos.x, gridPos.y, 0, 0);

    return pointerState;
  }

  /**
   * Handles pointer motion (mouse move / touch move).
   * Computes dragging speed, determines magnitude of applied force vector,
   * and injects momentum/mass into the simulation space.
   * 
   * @param {number|string} id - Pointer identifier.
   * @param {number} clientX - Screen X position.
   * @param {number} clientY - Screen Y position.
   * @param {number} [time] - Timestamp in ms.
   * @returns {Object|null} Updated pointer state.
   */
  handlePointerMove(id, clientX, clientY, time) {
    const pointer = this.activePointers.get(id);
    if (!pointer) return null;

    const now = time ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const canvasPos = this.clientToCanvas(clientX, clientY);
    const gridPos = this.clientToGrid(clientX, clientY);

    // Elapsed time in seconds (bounded to prevent division by zero or large gaps)
    const dt = Math.max(0.001, (now - pointer.lastTime) / 1000);

    const dx = gridPos.x - pointer.lastGridX;
    const dy = gridPos.y - pointer.lastGridY;
    const dist = Math.hypot(dx, dy);

    // Instantaneous dragging speed in grid cells per second
    const speed = dist / dt;

    // Dragging speed directly determines the magnitude of the applied force vector
    const rawForce = speed * this.forceScale;
    const forceMagnitude = Math.min(rawForce, this.maxForce);

    let forceX = 0;
    let forceY = 0;
    if (dist > 1e-4 && forceMagnitude >= this.minSpeedThreshold) {
      forceX = (dx / dist) * forceMagnitude;
      forceY = (dy / dist) * forceMagnitude;
    }

    this.lastDragSpeed = speed;
    this.lastAppliedForce = forceMagnitude;

    // Fast drag stroke interpolation: prevents sparse droplet gaps on fast flicks
    if (this.interpolate && dist > this.brushRadius * 0.5) {
      const steps = Math.min(10, Math.ceil(dist / (this.brushRadius * 0.5)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const interpX = pointer.lastGridX + dx * t;
        const interpY = pointer.lastGridY + dy * t;
        this.applyInteraction(interpX, interpY, forceX, forceY);
      }
    } else {
      this.applyInteraction(gridPos.x, gridPos.y, forceX, forceY);
    }

    // Update pointer state
    pointer.lastClientX = clientX;
    pointer.lastClientY = clientY;
    pointer.lastCanvasX = canvasPos.x;
    pointer.lastCanvasY = canvasPos.y;
    pointer.lastGridX = gridPos.x;
    pointer.lastGridY = gridPos.y;
    pointer.lastTime = now;
    pointer.speed = speed;
    pointer.forceMagnitude = forceMagnitude;
    pointer.forceX = forceX;
    pointer.forceY = forceY;

    return pointer;
  }

  /**
   * Handles pointer release (mouse up / touch end / cancel).
   * @param {number|string} id - Pointer identifier.
   */
  handlePointerEnd(id) {
    this.activePointers.delete(id);
  }

  /**
   * Clears all active pointers.
   */
  clearAllPointers() {
    this.activePointers.clear();
  }

  /**
   * Injects mass, velocity force vectors, or obstacle changes into the fluid simulation.
   * 
   * @param {number} gx - Grid X coordinate.
   * @param {number} gy - Grid Y coordinate.
   * @param {number} forceX - Horizontal force vector component.
   * @param {number} forceY - Vertical force vector component.
   */
  applyInteraction(gx, gy, forceX, forceY) {
    if (!this.simulation) return;

    const { activeTool, brushRadius, densityAmount } = this;

    switch (activeTool) {
      case 'fluid': {
        // Inject fluid mass (density)
        this.simulation.addDensitySplat(gx, gy, brushRadius, densityAmount);
        // Inject velocity force vector if motion is detected
        if (Math.hypot(forceX, forceY) > 0.01) {
          this.simulation.addVelocityImpulse(gx, gy, brushRadius, forceX, forceY);
        }
        break;
      }

      case 'velocity': {
        // Push fluid with velocity force vector only (no new mass added)
        if (Math.hypot(forceX, forceY) > 0.01) {
          this.simulation.addVelocityImpulse(gx, gy, brushRadius, forceX * 1.5, forceY * 1.5);
        }
        break;
      }

      case 'obstacle': {
        // Draw solid circular obstacle
        this.simulation.setObstacleCircle(gx, gy, Math.max(1.5, brushRadius * 0.8), true);
        break;
      }

      case 'erase': {
        // Erase solid obstacle
        this.simulation.setObstacleCircle(gx, gy, Math.max(1.5, brushRadius * 0.8), false);
        break;
      }
    }
  }

  /**
   * Attaches unified pointer, touch, and mouse listeners to canvas.
   */
  attach() {
    const { canvas } = this;
    if (!canvas || !canvas.addEventListener) return;
    if (this._boundHandlers) return; // Already attached

    let usingPointerEvents = false;

    // 1. Pointer Events
    const onPointerDown = (e) => {
      usingPointerEvents = true;
      if (e.cancelable) e.preventDefault();
      try {
        if (canvas.setPointerCapture && e.pointerId != null) {
          canvas.setPointerCapture(e.pointerId);
        }
      } catch {
        // Fallback for mock environments
      }
      this.handlePointerStart(e.pointerId ?? 0, e.clientX, e.clientY, e.timeStamp || performance.now());
    };

    const onPointerMove = (e) => {
      if (!this.activePointers.has(e.pointerId ?? 0)) return;
      if (e.cancelable) e.preventDefault();
      this.handlePointerMove(e.pointerId ?? 0, e.clientX, e.clientY, e.timeStamp || performance.now());
    };

    const onPointerUp = (e) => {
      if (e.cancelable) e.preventDefault();
      try {
        if (canvas.releasePointerCapture && e.pointerId != null) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Fallback
      }
      this.handlePointerEnd(e.pointerId ?? 0);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    // 2. Touch Events (Multi-touch support & fallback)
    const onTouchStart = (e) => {
      if (usingPointerEvents) return;
      if (e.cancelable) e.preventDefault();
      const time = e.timeStamp || performance.now();
      const touches = e.changedTouches || e.touches || [];
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        this.handlePointerStart(`touch_${t.identifier}`, t.clientX, t.clientY, time);
      }
    };

    const onTouchMove = (e) => {
      if (usingPointerEvents) return;
      if (e.cancelable) e.preventDefault();
      const time = e.timeStamp || performance.now();
      const touches = e.changedTouches || e.touches || [];
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        this.handlePointerMove(`touch_${t.identifier}`, t.clientX, t.clientY, time);
      }
    };

    const onTouchEnd = (e) => {
      if (usingPointerEvents) return;
      if (e.cancelable) e.preventDefault();
      const touches = e.changedTouches || e.touches || [];
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        this.handlePointerEnd(`touch_${t.identifier}`);
      }
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    // 3. Mouse Events fallback
    const onMouseDown = (e) => {
      if (usingPointerEvents) return;
      if (e.cancelable) e.preventDefault();
      this.handlePointerStart('mouse', e.clientX, e.clientY, e.timeStamp || performance.now());
    };

    const onMouseMove = (e) => {
      if (usingPointerEvents) return;
      if (!this.activePointers.has('mouse')) return;
      if (e.cancelable) e.preventDefault();
      this.handlePointerMove('mouse', e.clientX, e.clientY, e.timeStamp || performance.now());
    };

    const onMouseUp = (e) => {
      if (usingPointerEvents) return;
      if (e.cancelable) e.preventDefault();
      this.handlePointerEnd('mouse');
    };

    canvas.addEventListener('mousedown', onMouseDown);
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }

    this._boundHandlers = {
      detach: () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('pointerleave', onPointerUp);

        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        canvas.removeEventListener('touchcancel', onTouchEnd);

        canvas.removeEventListener('mousedown', onMouseDown);
        if (typeof window !== 'undefined') {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        }
      },
    };
  }

  /**
   * Detaches event listeners and clears state.
   */
  detach() {
    if (this._boundHandlers) {
      this._boundHandlers.detach();
      this._boundHandlers = null;
    }
    this.clearAllPointers();
  }
}
