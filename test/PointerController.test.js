import { FluidSimulation } from '../src/core/FluidSimulation.js';
import { FluidRenderer } from '../src/rendering/FluidRenderer.js';
import { PointerController } from '../src/ui/PointerController.js';

export function runPointerControllerTests(assert) {
  console.log('--- Testing PointerController (Mouse & Touch Controls) ---');

  function createMockEnvironment(gridSize = 32, canvasWidth = 640, canvasHeight = 640) {
    const sim = new FluidSimulation({ width: gridSize, height: gridSize });

    const listeners = new Map();
    const mockCanvas = {
      width: canvasWidth,
      height: canvasHeight,
      clientWidth: canvasWidth,
      clientHeight: canvasHeight,
      capturedPointerId: null,
      addEventListener: (type, handler) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      removeEventListener: (type, handler) => {
        if (!listeners.has(type)) return;
        const arr = listeners.get(type).filter((h) => h !== handler);
        listeners.set(type, arr);
      },
      dispatchEvent: (event) => {
        const arr = listeners.get(event.type) || [];
        for (const h of arr) h(event);
      },
      getBoundingClientRect: () => ({
        left: 50,
        top: 50,
        width: canvasWidth,
        height: canvasHeight,
      }),
      setPointerCapture: (id) => {
        mockCanvas.capturedPointerId = id;
      },
      releasePointerCapture: (id) => {
        if (mockCanvas.capturedPointerId === id) mockCanvas.capturedPointerId = null;
      },
      getContext: () => ({
        putImageData: () => {},
        drawImage: () => {},
        clearRect: () => {},
      }),
    };

    const renderer = new FluidRenderer(mockCanvas, sim);
    const controller = new PointerController({
      canvas: mockCanvas,
      simulation: sim,
      renderer,
      activeTool: 'fluid',
      brushRadius: 3.0,
      densityAmount: 50.0,
      forceScale: 0.8,
      maxForce: 150.0,
    });

    return { sim, renderer, mockCanvas, controller, listeners };
  }

  // Test 1: Coordinate mapping accuracy to canvas space and grid space
  {
    const { controller, renderer } = createMockEnvironment(32, 640, 640);

    // Client (50, 50) is top-left corner
    const canvasTopLeft = controller.clientToCanvas(50, 50);
    assert.strictEqual(canvasTopLeft.x, 0, 'Client top-left maps to canvas space (0, 0)');
    assert.strictEqual(canvasTopLeft.y, 0);

    const gridTopLeft = controller.clientToGrid(50, 50);
    assert.strictEqual(gridTopLeft.x, 0, 'Client top-left maps to grid space (0, 0)');
    assert.strictEqual(gridTopLeft.y, 0);

    // Client (50 + 320, 50 + 320) is center
    const canvasCenter = controller.clientToCanvas(370, 370);
    assert.strictEqual(canvasCenter.x, 320, 'Client center maps to canvas space (320, 320)');
    assert.strictEqual(canvasCenter.y, 320);

    const gridCenter = controller.clientToGrid(370, 370);
    assert.strictEqual(Math.round(gridCenter.x), 16, 'Client center maps to grid cell (16, 16)');
    assert.strictEqual(Math.round(gridCenter.y), 16);

    // Client (50 + 640, 50 + 640) is bottom-right corner
    const canvasBtmRight = controller.clientToCanvas(690, 690);
    assert.strictEqual(canvasBtmRight.x, 640, 'Client bottom-right maps to canvas space (640, 640)');
    assert.strictEqual(canvasBtmRight.y, 640);

    const gridBtmRight = controller.clientToGrid(690, 690);
    assert.strictEqual(Math.round(gridBtmRight.x), 31, 'Client bottom-right maps to grid cell (31, 31)');
    assert.strictEqual(Math.round(gridBtmRight.y), 31);

    console.log('  Passed: Mouse and touch coordinates accurately map to canvas space and grid cells.');
  }

  // Test 2: Dragging speed determines the magnitude of applied force vector
  {
    const { controller } = createMockEnvironment(64, 640, 640);

    // 1. Slow drag: 10 pixels in 500 ms (0.5 s)
    // 50 + 320 = 370 (grid cell 32)
    controller.handlePointerStart(1, 370, 370, 1000);
    const slowState = controller.handlePointerMove(1, 380, 370, 1500); // 10px move over 0.5s
    controller.handlePointerEnd(1);

    // 2. Fast drag: 100 pixels in 100 ms (0.1 s)
    controller.handlePointerStart(2, 370, 370, 2000);
    const fastState = controller.handlePointerMove(2, 470, 370, 2100); // 100px move over 0.1s
    controller.handlePointerEnd(2);

    assert.ok(slowState != null, 'Slow drag state returned');
    assert.ok(fastState != null, 'Fast drag state returned');

    assert.ok(
      fastState.speed > slowState.speed,
      `Fast drag speed (${fastState.speed.toFixed(2)}) must exceed slow drag speed (${slowState.speed.toFixed(2)})`
    );

    assert.ok(
      fastState.forceMagnitude > slowState.forceMagnitude,
      `Fast drag force magnitude (${fastState.forceMagnitude.toFixed(2)}) must exceed slow drag (${slowState.forceMagnitude.toFixed(2)})`
    );

    // Magnitude proportionality verification
    const expectedSlowMagnitude = Math.min(slowState.speed * controller.forceScale, controller.maxForce);
    assert.strictEqual(
      Math.abs(slowState.forceMagnitude - expectedSlowMagnitude) < 1e-4,
      true,
      'Applied force vector magnitude is directly proportional to drag speed'
    );

    // 3. Extreme flick clamping test
    controller.handlePointerStart(3, 50, 50, 3000);
    const extremeState = controller.handlePointerMove(3, 650, 650, 3010); // Massive jump in 10ms
    controller.handlePointerEnd(3);

    assert.strictEqual(
      extremeState.forceMagnitude,
      controller.maxForce,
      `Extreme drag speed must clamp cleanly to maxForce (${controller.maxForce})`
    );

    console.log('  Passed: Dragging speed directly determines applied force vector magnitude (with bounds protection).');
  }

  // Test 3: Fluid mass injection and velocity vector impulses
  {
    const { sim, controller } = createMockEnvironment(32, 640, 640);

    const initialDensity = sim.solver.getTotalDensity();
    assert.strictEqual(initialDensity, 0, 'Grid starts empty');

    // Pointer start immediately injects fluid mass
    controller.setActiveTool('fluid');
    controller.handlePointerStart(1, 370, 370, 1000);

    const massAfterStart = sim.solver.getTotalDensity();
    assert.ok(massAfterStart > 0, `Pointer tap immediately injects fluid mass (${massAfterStart.toFixed(1)})`);

    // Moving pointer injects both additional mass and velocity impulse
    controller.handlePointerMove(1, 400, 370, 1050);
    const massAfterMove = sim.solver.getTotalDensity();
    assert.ok(massAfterMove > massAfterStart, 'Dragging further injects additional fluid mass');

    const maxSpeed = sim.solver.getMaxSpeed();
    assert.ok(maxSpeed > 0.5, `Velocity impulse injected into simulation (maxSpeed = ${maxSpeed.toFixed(2)})`);

    controller.handlePointerEnd(1);

    // Test 'velocity' push-only mode
    controller.setActiveTool('velocity');
    const massBeforePush = sim.solver.getTotalDensity();
    controller.handlePointerStart(2, 200, 200, 2000);
    controller.handlePointerMove(2, 250, 200, 2050);
    controller.handlePointerEnd(2);

    const massAfterPush = sim.solver.getTotalDensity();
    assert.strictEqual(
      Math.round(massAfterPush),
      Math.round(massBeforePush),
      'Push-only tool applies velocity without adding new fluid mass'
    );

    // Test obstacle tool
    controller.setActiveTool('obstacle');
    controller.handlePointerStart(3, 370, 370, 3000);
    controller.handlePointerEnd(3);

    const solidBuffer = sim.getObstacleBuffer();
    const cellIdx = 16 * 32 + 16;
    assert.strictEqual(solidBuffer[cellIdx], 1, 'Obstacle tool paints solid cell on canvas');

    // Test erase tool
    controller.setActiveTool('erase');
    controller.handlePointerStart(4, 370, 370, 4000);
    controller.handlePointerEnd(4);
    assert.strictEqual(solidBuffer[cellIdx], 0, 'Erase tool clears solid cell');

    console.log('  Passed: Mass and velocity vectors injected correctly across interaction modes.');
  }

  // Test 4: Touch and Mouse event listeners & Multi-Touch Concurrency
  {
    const { controller, mockCanvas, sim } = createMockEnvironment(32, 640, 640);

    // Simulate multi-touch start with 2 simultaneous fingers
    const touch1 = { identifier: 101, clientX: 200, clientY: 200 };
    const touch2 = { identifier: 102, clientX: 400, clientY: 400 };

    mockCanvas.dispatchEvent({
      type: 'touchstart',
      cancelable: true,
      preventDefault: () => {},
      changedTouches: [touch1, touch2],
      timeStamp: 1000,
    });

    assert.strictEqual(controller.getActivePointerCount(), 2, 'Two touches active concurrently');
    assert.strictEqual(controller.isPointerDown, true, 'isPointerDown is true');

    // Move touch 1
    mockCanvas.dispatchEvent({
      type: 'touchmove',
      cancelable: true,
      preventDefault: () => {},
      changedTouches: [{ identifier: 101, clientX: 240, clientY: 200 }],
      timeStamp: 1050,
    });

    const pointer1 = controller.getPointerState('touch_101');
    assert.ok(pointer1 != null, 'Pointer 1 tracked');
    assert.ok(pointer1.speed > 0, 'Pointer 1 speed computed');
    assert.ok(pointer1.forceMagnitude > 0, 'Pointer 1 force applied');

    // Release touch 1, touch 2 remains active
    mockCanvas.dispatchEvent({
      type: 'touchend',
      cancelable: true,
      preventDefault: () => {},
      changedTouches: [{ identifier: 101, clientX: 240, clientY: 200 }],
    });

    assert.strictEqual(controller.getActivePointerCount(), 1, 'One touch remains active');

    // Release touch 2
    mockCanvas.dispatchEvent({
      type: 'touchend',
      cancelable: true,
      preventDefault: () => {},
      changedTouches: [{ identifier: 102, clientX: 400, clientY: 400 }],
    });

    assert.strictEqual(controller.getActivePointerCount(), 0, 'All touches released');
    assert.strictEqual(controller.isPointerDown, false, 'isPointerDown is false');

    // Test PointerEvents standard
    mockCanvas.dispatchEvent({
      type: 'pointerdown',
      pointerId: 42,
      clientX: 300,
      clientY: 300,
      timeStamp: 2000,
      cancelable: true,
      preventDefault: () => {},
    });

    assert.strictEqual(controller.getActivePointerCount(), 1, 'Pointer event captured');
    assert.strictEqual(mockCanvas.capturedPointerId, 42, 'Pointer capture requested');

    mockCanvas.dispatchEvent({
      type: 'pointermove',
      pointerId: 42,
      clientX: 350,
      clientY: 300,
      timeStamp: 2050,
      cancelable: true,
      preventDefault: () => {},
    });

    mockCanvas.dispatchEvent({
      type: 'pointerup',
      pointerId: 42,
      timeStamp: 2100,
      cancelable: true,
      preventDefault: () => {},
    });

    assert.strictEqual(controller.getActivePointerCount(), 0, 'Pointer released');
    assert.strictEqual(mockCanvas.capturedPointerId, null, 'Pointer capture released');

    controller.detach();
    console.log('  Passed: Multi-touch gestures and PointerEvents track concurrently without interference.');
  }

  // Test 5: Responsiveness and zero-lag immediate physics execution
  {
    const { controller, sim } = createMockEnvironment(32, 640, 640);

    const initialTotal = sim.solver.getTotalDensity();

    // Call start: verify density is non-zero IMMEDIATELY (no delay)
    controller.handlePointerStart(1, 370, 370, 100);
    const densityRightAway = sim.solver.getTotalDensity();
    assert.ok(densityRightAway > initialTotal, 'Density injected immediately upon pointer down');

    // Call move: verify speed is non-zero IMMEDIATELY
    controller.handlePointerMove(1, 420, 370, 120);
    const speedRightAway = sim.solver.getMaxSpeed();
    assert.ok(speedRightAway > 1.0, 'Velocity impulse injected immediately upon pointer move');

    controller.handlePointerEnd(1);
    console.log('  Passed: Interaction operates with zero frame delay and immediate physics responsiveness.');
  }
}
