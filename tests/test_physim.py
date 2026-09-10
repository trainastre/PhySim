import subprocess
import os
import re

def test_node_test_suite():
    """Runs the full JavaScript test suite using node."""
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    test_file = os.path.join(project_dir, "test", "run-tests.js")
    
    result = subprocess.run(
        ["node", test_file],
        cwd=project_dir,
        capture_output=True,
        text=True,
    )
    print(result.stdout)
    if result.stderr:
        print(result.stderr)
    assert result.returncode == 0, f"Node test suite failed:\n{result.stderr}\n{result.stdout}"

def test_html_interface_structure():
    """Verifies that index.html contains all required UI components."""
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    html_file = os.path.join(project_dir, "index.html")
    assert os.path.exists(html_file), "index.html must exist"

    with open(html_file, "r", encoding="utf-8") as f:
        content = f.read()

    # Verify canvas element
    assert 'id="fluid-canvas"' in content, "HTML must contain canvas with id fluid-canvas"
    
    # Verify core sliders: viscosity, gravity, density dissipation
    assert 'id="viscosity-slider"' in content, "Must have viscosity slider"
    assert 'id="gravity-slider"' in content, "Must have gravity slider"
    assert 'id="dissipation-slider"' in content, "Must have density dissipation slider"

    # Verify viewport meta tag
    assert 'name="viewport"' in content, "Must have responsive viewport meta tag"

    # Verify script module
    assert 'type="module"' in content, "Must load ES module script"

def test_responsive_css():
    """Verifies that responsive styling is present for viewports."""
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    css_file = os.path.join(project_dir, "src", "ui", "style.css")
    assert os.path.exists(css_file), "style.css must exist"

    with open(css_file, "r", encoding="utf-8") as f:
        content = f.read()

    assert "@media" in content, "CSS must include media queries for responsive viewports"
    assert "touch-action: none" in content, "Canvas must have touch-action: none for touch devices"

def test_interactive_mouse_touch_controls():
    """Verifies that interactive mouse and touch controls and coordinate mappings are implemented."""
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pointer_file = os.path.join(project_dir, "src", "ui", "PointerController.js")
    assert os.path.exists(pointer_file), "PointerController.js must exist"

    with open(pointer_file, "r", encoding="utf-8") as f:
        content = f.read()

    # Verify pointer / touch events
    assert "pointerdown" in content, "Must listen for pointerdown"
    assert "pointermove" in content, "Must listen for pointermove"
    assert "touchstart" in content, "Must listen for touchstart"
    assert "touchmove" in content, "Must listen for touchmove"

    # Verify coordinate mapping to canvas space
    assert "clientToCanvas" in content, "Must implement clientToCanvas"

    # Verify dragging speed determines force vector magnitude
    assert "speed" in content, "Must calculate pointer dragging speed"
    assert "forceMagnitude" in content, "Must determine force magnitude from drag speed"
