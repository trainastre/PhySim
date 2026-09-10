/**
 * Real-time Performance Monitor & Profiler for PhySim.
 * Tracks frame rate (FPS), execution timings (simulation and render passes),
 * long frame drops, and integrates with Browser Developer Tools (User Timing API & DevTools Profiler).
 *
 * Implements zero-allocation ring buffers to eliminate garbage collection spikes during profiling.
 */
export class PerformanceMonitor {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.targetFps=60] - Target frame rate in frames per second.
   * @param {number} [options.historySize=60] - Number of frames to keep in circular rolling history.
   * @param {boolean} [options.enableUserTiming=true] - Whether to emit performance.mark and performance.measure.
   */
  constructor(options = {}) {
    this.targetFps = options.targetFps ?? 60;
    this.targetFrameTime = 1000 / this.targetFps; // ~16.667ms for 60 FPS
    this.historySize = Math.max(10, options.historySize ?? 60);
    this.enableUserTiming = options.enableUserTiming ?? true;

    // Zero-allocation rolling ring buffers for metric histories
    this.frameTimeHistory = new Float32Array(this.historySize);
    this.simTimeHistory = new Float32Array(this.historySize);
    this.renderTimeHistory = new Float32Array(this.historySize);

    this.historyIndex = 0;
    this.historyCount = 0;
    this.totalFrameCount = 0;
    this.droppedFrameCount = 0;

    // Instantaneous and smoothed performance metrics
    this.fps = this.targetFps;
    this.avgFps = this.targetFps;
    this.minFps = this.targetFps;
    this.maxFps = this.targetFps;
    this.frameTime = this.targetFrameTime;
    this.simTime = 0;
    this.renderTime = 0;
    this.cpuLoadPercent = 0;

    // Timers
    this._lastFrameStart = 0;
    this._currentFrameStart = 0;
    this._simStart = 0;
    this._renderStart = 0;
    this._userTimingAvailable = typeof performance !== 'undefined' &&
      typeof performance.mark === 'function' &&
      typeof performance.measure === 'function';

    // Cached stats object for zero-allocation getStats() queries
    this._cachedStats = {
      fps: this.fps,
      avgFps: this.avgFps,
      minFps: this.minFps,
      maxFps: this.maxFps,
      frameTime: this.frameTime,
      simTime: this.simTime,
      renderTime: this.renderTime,
      cpuLoadPercent: this.cpuLoadPercent,
      totalFrames: 0,
      droppedFrames: 0,
      targetFps: this.targetFps,
      targetFrameTime: this.targetFrameTime,
    };
  }

  /**
   * Begins frame execution timing.
   * Emits browser DevTools performance mark.
   * @param {number} [timestamp] - Current timestamp from requestAnimationFrame or performance.now().
   */
  beginFrame(timestamp) {
    const now = timestamp ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (this._currentFrameStart > 0) {
      // Calculate delta from start of previous frame to start of this frame
      const frameDelta = now - this._currentFrameStart;
      if (frameDelta > 0 && frameDelta < 1000) {
        this.frameTime = frameDelta;
        this.fps = 1000 / frameDelta;

        // Record in circular buffer
        this.frameTimeHistory[this.historyIndex] = frameDelta;
        this.historyIndex = (this.historyIndex + 1) % this.historySize;
        if (this.historyCount < this.historySize) {
          this.historyCount++;
        }

        // Detect dropped frame (execution exceeded target budget by > 20%)
        if (frameDelta > this.targetFrameTime * 1.2) {
          this.droppedFrameCount++;
        }

        this._recomputeStats();
      }
    }

    this._lastFrameStart = this._currentFrameStart;
    this._currentFrameStart = now;
    this.totalFrameCount++;

    if (this.enableUserTiming && this._userTimingAvailable) {
      try {
        performance.mark('physim:frame-start');
      } catch {
        // Fallback for mock environments
      }
    }
  }

  /**
   * Begins physics simulation step timing.
   */
  beginSim() {
    this._simStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.enableUserTiming && this._userTimingAvailable) {
      try {
        performance.mark('physim:sim-start');
      } catch {
        // Fallback
      }
    }
  }

  /**
   * Concludes physics simulation step timing.
   */
  endSim() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.simTime = Math.max(0, now - this._simStart);

    const slot = (this.historyIndex === 0 ? this.historySize : this.historyIndex) - 1;
    this.simTimeHistory[slot] = this.simTime;

    if (this.enableUserTiming && this._userTimingAvailable) {
      try {
        performance.mark('physim:sim-end');
        performance.measure('physim:sim-step', 'physim:sim-start', 'physim:sim-end');
      } catch {
        // Fallback
      }
    }
  }

  /**
   * Begins canvas rendering pass timing.
   */
  beginRender() {
    this._renderStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.enableUserTiming && this._userTimingAvailable) {
      try {
        performance.mark('physim:render-start');
      } catch {
        // Fallback
      }
    }
  }

  /**
   * Concludes canvas rendering pass timing.
   */
  endRender() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.renderTime = Math.max(0, now - this._renderStart);

    const slot = (this.historyIndex === 0 ? this.historySize : this.historyIndex) - 1;
    this.renderTimeHistory[slot] = this.renderTime;

    if (this.enableUserTiming && this._userTimingAvailable) {
      try {
        performance.mark('physim:render-end');
        performance.measure('physim:render', 'physim:render-start', 'physim:render-end');
      } catch {
        // Fallback
      }
    }
  }

  /**
   * Concludes frame execution timing.
   */
  endFrame() {
    if (this.enableUserTiming && this._userTimingAvailable) {
      try {
        performance.mark('physim:frame-end');
        performance.measure('physim:frame', 'physim:frame-start', 'physim:frame-end');

        // Periodically clear DevTools User Timing buffer to prevent unbounded memory growth
        if (this.totalFrameCount % 120 === 0 && typeof performance.clearMarks === 'function') {
          performance.clearMarks('physim:frame-start');
          performance.clearMarks('physim:frame-end');
          performance.clearMarks('physim:sim-start');
          performance.clearMarks('physim:sim-end');
          performance.clearMarks('physim:render-start');
          performance.clearMarks('physim:render-end');
          if (typeof performance.clearMeasures === 'function') {
            performance.clearMeasures('physim:frame');
            performance.clearMeasures('physim:sim-step');
            performance.clearMeasures('physim:render');
          }
        }
      } catch {
        // Fallback
      }
    }
  }

  /**
   * Recomputes rolling statistical aggregates over history buffer.
   * @private
   */
  _recomputeStats() {
    if (this.historyCount === 0) return;

    let sumFrameTime = 0;
    let minTime = Infinity;
    let maxTime = 0;
    let sumSimTime = 0;
    let sumRenderTime = 0;

    for (let i = 0; i < this.historyCount; i++) {
      const ft = this.frameTimeHistory[i];
      sumFrameTime += ft;
      if (ft < minTime) minTime = ft;
      if (ft > maxTime) maxTime = ft;

      sumSimTime += this.simTimeHistory[i];
      sumRenderTime += this.renderTimeHistory[i];
    }

    const avgFrameTime = sumFrameTime / this.historyCount;
    this.avgFps = avgFrameTime > 0 ? 1000 / avgFrameTime : this.targetFps;
    this.minFps = maxTime > 0 ? 1000 / maxTime : this.targetFps;
    this.maxFps = minTime > 0 ? 1000 / minTime : this.targetFps;

    // CPU load percentage: (simTime + renderTime) / frameTime
    const activeTime = (sumSimTime + sumRenderTime) / this.historyCount;
    this.cpuLoadPercent = avgFrameTime > 0 ? Math.min(100, (activeTime / avgFrameTime) * 100) : 0;
  }

  /**
   * Returns current performance telemetry without allocating new objects.
   * @returns {Object} Cached performance statistics.
   */
  getStats() {
    const s = this._cachedStats;
    s.fps = Math.round(this.fps);
    s.avgFps = Math.round(this.avgFps);
    s.minFps = Math.round(this.minFps);
    s.maxFps = Math.round(this.maxFps);
    s.frameTime = this.frameTime;
    s.simTime = this.simTime;
    s.renderTime = this.renderTime;
    s.cpuLoadPercent = this.cpuLoadPercent;
    s.totalFrames = this.totalFrameCount;
    s.droppedFrames = this.droppedFrameCount;
    s.targetFps = this.targetFps;
    s.targetFrameTime = this.targetFrameTime;
    return s;
  }

  /**
   * Resets all performance tracking metrics and buffers.
   */
  reset() {
    this.frameTimeHistory.fill(0);
    this.simTimeHistory.fill(0);
    this.renderTimeHistory.fill(0);
    this.historyIndex = 0;
    this.historyCount = 0;
    this.totalFrameCount = 0;
    this.droppedFrameCount = 0;
    this.fps = this.targetFps;
    this.avgFps = this.targetFps;
    this.minFps = this.targetFps;
    this.maxFps = this.targetFps;
    this.frameTime = this.targetFrameTime;
    this.simTime = 0;
    this.renderTime = 0;
    this.cpuLoadPercent = 0;
    this._currentFrameStart = 0;
    this._lastFrameStart = 0;
  }

  /**
   * Starts browser developer tools CPU profiler.
   * @param {string} [label='PhySim']
   */
  startProfile(label = 'PhySim') {
    if (typeof console !== 'undefined' && typeof console.profile === 'function') {
      console.profile(label);
    }
  }

  /**
   * Stops browser developer tools CPU profiler.
   * @param {string} [label='PhySim']
   */
  stopProfile(label = 'PhySim') {
    if (typeof console !== 'undefined' && typeof console.profileEnd === 'function') {
      console.profileEnd(label);
    }
  }
}
