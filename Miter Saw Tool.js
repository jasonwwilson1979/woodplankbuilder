import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MATERIALS = {
  '2x4': { width: 3.5, height: 1.5, name: '2×4' },
  '2x6': { width: 5.5, height: 1.5, name: '2×6' },
  '4x4': { width: 3.5, height: 3.5, name: '4×4' },
  '4x6': { width: 5.5, height: 3.5, name: '4×6' }
};

let state = {
  material: '2x4',
  stockLength: 96,
  miterAngle: 0,
  cutPosition: 48,
  cutPieces: [],
  cutHistory: [],
  zoom: 1.2,
  panX: 0,
  panY: 0,
  isDragging: false,
  isPanning: false,
  lastMouseX: 0,
  lastMouseY: 0,
  showLabels: true
};

const canvas2d = document.getElementById('canvas2d');
const ctx2d = canvas2d.getContext('2d');
let canvas3d, scene3d, camera3d, renderer3d, controls3d;
let plankMesh3d, previewGroup3d;
let currentView = '2d';

function init() {
  resizeCanvases();
  window.addEventListener('resize', resizeCanvases);
  init2DEvents();
  init3D();
  draw2D();
  animate3D();
}

function resizeCanvases() {
  const panel = document.getElementById('centerPanel');
  canvas2d.width = panel.clientWidth;
  canvas2d.height = panel.clientHeight;
  if (canvas3d) {
    canvas3d.width = panel.clientWidth;
    canvas3d.height = panel.clientHeight;
    if (camera3d) {
      camera3d.aspect = panel.clientWidth / panel.clientHeight;
      camera3d.updateProjectionMatrix();
      renderer3d.setSize(panel.clientWidth, panel.clientHeight);
    }
  }
  if (currentView === '2d') draw2D();
}

// ===== 2D DRAWING =====
function draw2D() {
  const w = canvas2d.width;
  const h = canvas2d.height;
  ctx2d.clearRect(0, 0, w, h);
  
  ctx2d.fillStyle = '#1a1a1a';
  ctx2d.fillRect(0, 0, w, h);
  
  const mat = MATERIALS[state.material];
  const scale = state.zoom;
  const cx = w / 2 + state.panX;
  const cy = h / 2 + state.panY;
  
  const plankW = state.stockLength * scale;
  const plankH = mat.width * scale;
  
  // Grid (subtle)
  ctx2d.strokeStyle = '#222';
  ctx2d.lineWidth = 1;
  const gridSize = 48 * scale;
  const offsetX = (cx) % gridSize;
  const offsetY = (cy) % gridSize;
  for (let x = offsetX % gridSize; x < w; x += gridSize) {
    ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, h); ctx2d.stroke();
  }
  for (let y = offsetY % gridSize; y < h; y += gridSize) {
    ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(w, y); ctx2d.stroke();
  }
  
  // Wood plank
  const grad = ctx2d.createLinearGradient(cx - plankW/2, cy - plankH/2, cx + plankW/2, cy + plankH/2);
  grad.addColorStop(0, '#8B5A2B');
  grad.addColorStop(0.3, '#A0703A');
  grad.addColorStop(0.5, '#8B5A2B');
  grad.addColorStop(0.7, '#A0703A');
  grad.addColorStop(1, '#8B5A2B');
  
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(cx - plankW/2, cy - plankH/2, plankW, plankH);
  
  // Plank border
  ctx2d.strokeStyle = '#5A3A1A';
  ctx2d.lineWidth = 2;
  ctx2d.strokeRect(cx - plankW/2, cy - plankH/2, plankW, plankH);
  
  // Wood grain
  ctx2d.strokeStyle = 'rgba(139,90,43,0.25)';
  ctx2d.lineWidth = 0.5;
  for (let i = 0; i < plankH; i += 4 * scale) {
    ctx2d.beginPath();
    ctx2d.moveTo(cx - plankW/2, cy - plankH/2 + i);
    ctx2d.lineTo(cx + plankW/2, cy - plankH/2 + i);
    ctx2d.stroke();
  }
  
  // Measurement marks every 12"
  if (state.showLabels) {
    ctx2d.fillStyle = '#888';
    ctx2d.font = `${Math.max(8, 9 * scale)}px monospace`;
    ctx2d.textAlign = 'center';
    for (let i = 0; i <= state.stockLength; i += 12) {
      const x = cx - plankW/2 + (i * scale);
      ctx2d.strokeStyle = '#555';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(x, cy - plankH/2 - 10);
      ctx2d.lineTo(x, cy - plankH/2 - 4);
      ctx2d.stroke();
      ctx2d.fillText(i + '"', x, cy - plankH/2 - 14);
    }
  } else {
    // Just tick marks without labels
    ctx2d.strokeStyle = '#444';
    ctx2d.lineWidth = 1;
    for (let i = 0; i <= state.stockLength; i += 12) {
      const x = cx - plankW/2 + (i * scale);
      ctx2d.beginPath();
      ctx2d.moveTo(x, cy - plankH/2 - 6);
      ctx2d.lineTo(x, cy - plankH/2 - 3);
      ctx2d.stroke();
    }
  }
  
  // Draw cut line
  const cutX = cx - plankW/2 + (state.cutPosition * scale);
  const angleRad = (state.miterAngle * Math.PI) / 180;
  
  // Dashed cut line extending beyond plank
  ctx2d.strokeStyle = '#ff4444';
  ctx2d.lineWidth = 2;
  ctx2d.setLineDash([8, 4]);
  ctx2d.beginPath();
  ctx2d.moveTo(cutX, cy - plankH/2 - 40);
  ctx2d.lineTo(cutX, cy + plankH/2 + 40);
  ctx2d.stroke();
  ctx2d.setLineDash([]);
  
  // Angled cut line (solid, showing actual cut angle)
  if (state.miterAngle !== 0) {
    const lineLen = plankH + 60;
    ctx2d.strokeStyle = '#ff4444';
    ctx2d.lineWidth = 2.5;
    ctx2d.beginPath();
    ctx2d.moveTo(cutX - Math.tan(angleRad) * lineLen/2, cy - lineLen/2);
    ctx2d.lineTo(cutX + Math.tan(angleRad) * lineLen/2, cy + lineLen/2);
    ctx2d.stroke();
    
    // Angle arc
    ctx2d.strokeStyle = '#ffaa00';
    ctx2d.lineWidth = 2;
    const arcR = 25 * scale;
    ctx2d.beginPath();
    ctx2d.arc(cutX, cy, arcR, -Math.PI/2, -Math.PI/2 + angleRad);
    ctx2d.stroke();
    
    // Angle label
    ctx2d.fillStyle = '#ffaa00';
    ctx2d.font = `bold ${14 * scale}px sans-serif`;
    ctx2d.textAlign = 'center';
    ctx2d.fillText(Math.abs(state.miterAngle) + '°', cutX + (state.miterAngle > 0 ? 25 : -25), cy);
  }
  
  // Cut position label
  ctx2d.fillStyle = '#ff4444';
  ctx2d.font = `bold ${12 * scale}px monospace`;
  ctx2d.textAlign = 'center';
  ctx2d.fillText(state.cutPosition + '"', cutX, cy + plankH/2 + 55);
  
  // Preview highlight
  if (state.isPreviewing) {
    const leftW = state.cutPosition * scale;
    ctx2d.fillStyle = 'rgba(0, 255, 0, 0.15)';
    ctx2d.fillRect(cx - plankW/2, cy - plankH/2, leftW, plankH);
    ctx2d.strokeStyle = '#0f0';
    ctx2d.lineWidth = 2;
    ctx2d.strokeRect(cx - plankW/2, cy - plankH/2, leftW, plankH);
  }
  
  // Material & length label
  ctx2d.fillStyle = '#fff';
  ctx2d.font = `bold ${12 * scale}px sans-serif`;
  ctx2d.textAlign = 'center';
  ctx2d.fillText(mat.name + ' × ' + state.stockLength + '"', cx, cy + 3);
  
  // Saw blade visualization
  drawSawBlade(cutX, cy, plankH, scale, angleRad);
}

function drawSawBlade(cutX, cy, plankH, scale, angleRad) {
  const bladeRadius = 22 * scale;
  const bladeY = cy - plankH/2 - bladeRadius - 15;
  
  // Saw guard (semi-circle housing)
  ctx2d.fillStyle = 'rgba(80, 80, 80, 0.6)';
  ctx2d.beginPath();
  ctx2d.arc(cutX, bladeY, bladeRadius, Math.PI, 0);
  ctx2d.lineTo(cutX + bladeRadius, bladeY + bladeRadius * 0.3);
  ctx2d.arc(cutX, bladeY, bladeRadius * 0.65, 0, Math.PI, true);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.strokeStyle = '#666';
  ctx2d.lineWidth = 1.5;
  ctx2d.stroke();
  
  // Saw blade
  ctx2d.fillStyle = '#bbb';
  ctx2d.beginPath();
  ctx2d.arc(cutX, bladeY, bladeRadius * 0.55, 0, Math.PI * 2);
  ctx2d.fill();
  ctx2d.strokeStyle = '#888';
  ctx2d.lineWidth = 1;
  ctx2d.stroke();
  
  // Blade teeth
  const teeth = 10;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const ir = bladeRadius * 0.35;
    const or = bladeRadius * 0.55;
    ctx2d.fillStyle = '#aaa';
    ctx2d.beginPath();
    ctx2d.moveTo(cutX + Math.cos(a) * ir, bladeY + Math.sin(a) * ir);
    ctx2d.lineTo(cutX + Math.cos(a + 0.35) * or, bladeY + Math.sin(a + 0.35) * or);
    ctx2d.lineTo(cutX + Math.cos(a + 0.7) * ir, bladeY + Math.sin(a + 0.7) * ir);
    ctx2d.closePath();
    ctx2d.fill();
  }
  
  // Center hub
  ctx2d.fillStyle = '#666';
  ctx2d.beginPath();
  ctx2d.arc(cutX, bladeY, 4 * scale, 0, Math.PI * 2);
  ctx2d.fill();
  ctx2d.strokeStyle = '#555';
  ctx2d.lineWidth = 1;
  ctx2d.stroke();
  
  // Blade shaft
  ctx2d.strokeStyle = '#777';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  ctx2d.moveTo(cutX, bladeY);
  ctx2d.lineTo(cutX, bladeY + bladeRadius + 15);
  ctx2d.stroke();
}

// ===== 2D EVENTS =====
function init2DEvents() {
  canvas2d.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      state.isPanning = true;
      state.lastMouseX = e.clientX;
      state.lastMouseY = e.clientY;
      return;
    }
    
    const rect = canvas2d.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cx = canvas2d.width / 2 + state.panX;
    const cutX = cx - (state.stockLength * state.zoom) / 2 + (state.cutPosition * state.zoom);
    
    if (Math.abs(x - cutX) < 15) {
      state.isDragging = true;
      canvas2d.style.cursor = 'ew-resize';
    }
  });
  
  canvas2d.addEventListener('mousemove', (e) => {
    if (state.isPanning) {
      state.panX += e.clientX - state.lastMouseX;
      state.panY += e.clientY - state.lastMouseY;
      state.lastMouseX = e.clientX;
      state.lastMouseY = e.clientY;
      draw2D();
      return;
    }
    
    if (state.isDragging) {
      const rect = canvas2d.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const cx = canvas2d.width / 2 + state.panX;
      const newCutPos = (x - (cx - (state.stockLength * state.zoom) / 2)) / state.zoom;
      state.cutPosition = Math.max(2, Math.min(state.stockLength - 2, Math.round(newCutPos * 2) / 2));
      document.getElementById('cutPosition').value = state.cutPosition;
      document.getElementById('cutPositionVal').textContent = state.cutPosition + '"';
      draw2D();
    }
    
    if (!state.isDragging && !state.isPanning) {
      const rect = canvas2d.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const cx = canvas2d.width / 2 + state.panX;
      const cutX = cx - (state.stockLength * state.zoom) / 2 + (state.cutPosition * state.zoom);
      canvas2d.style.cursor = Math.abs(x - cutX) < 15 ? 'ew-resize' : 'default';
    }
  });
  
  canvas2d.addEventListener('mouseup', () => {
    state.isDragging = false;
    state.isPanning = false;
    canvas2d.style.cursor = 'default';
  });
  
  canvas2d.addEventListener('mouseleave', () => {
    state.isDragging = false;
    state.isPanning = false;
  });
  
  canvas2d.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    state.zoom = Math.max(0.3, Math.min(5, state.zoom * delta));
    draw2D();
  });
  
  canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ===== 3D SETUP =====
function init3D() {
  canvas3d = document.getElementById('canvas3d');
  
  scene3d = new THREE.Scene();
  scene3d.background = new THREE.Color(0x1a1a1a);
  
  camera3d = new THREE.PerspectiveCamera(45, canvas3d.width / canvas3d.height, 0.1, 1000);
  camera3d.position.set(40, 50, 60);
  
  renderer3d = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
  renderer3d.setSize(canvas3d.width, canvas3d.height);
  renderer3d.shadowMap.enabled = true;
  
  controls3d = new OrbitControls(camera3d, canvas3d);
  controls3d.enableDamping = true;
  
  scene3d.add(new THREE.AmbientLight(0x404040, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(30, 50, 30);
  dirLight.castShadow = true;
  scene3d.add(dirLight);
  
  const grid = new THREE.GridHelper(200, 20, 0x333333, 0x222222);
  grid.position.y = -3;
  scene3d.add(grid);
  
  update3DPlank();
}

function animate3D() {
  requestAnimationFrame(animate3D);
  if (controls3d) controls3d.update();
  if (renderer3d && scene3d && camera3d) renderer3d.render(scene3d, camera3d);
}

function inchesToUnits(inches) { return inches * 1.0; } // Larger scale for better visibility

// Create a box geometry with an angled (miter) cut on one end
// angleOnRight: true = angle on right end, false = angle on left end
function createAngledBoxGeometry(length, height, width, miterRad, angleOnRight) {
  const L = length, H = height, W = width;
  const offset = (W / 2) * Math.tan(miterRad);
  
  let v;
  if (angleOnRight) {
    // Straight on left, angled on right
    v = [
      -L/2, -H/2, -W/2,  // 0: left-bottom-back
      -L/2, -H/2,  W/2,  // 1: left-bottom-front
      -L/2,  H/2, -W/2,  // 2: left-top-back
      -L/2,  H/2,  W/2,  // 3: left-top-front
      L/2 - offset, -H/2, -W/2,  // 4: right-bottom-back
      L/2 + offset, -H/2,  W/2,  // 5: right-bottom-front
      L/2 - offset,  H/2, -W/2,  // 6: right-top-back
      L/2 + offset,  H/2,  W/2,  // 7: right-top-front
    ];
  } else {
    // Angled on left, straight on right
    v = [
      -L/2 - offset, -H/2, -W/2,  // 0: left-bottom-back
      -L/2 + offset, -H/2,  W/2,  // 1: left-bottom-front
      -L/2 - offset,  H/2, -W/2,  // 2: left-top-back
      -L/2 + offset,  H/2,  W/2,  // 3: left-top-front
      L/2, -H/2, -W/2,  // 4: right-bottom-back
      L/2, -H/2,  W/2,  // 5: right-bottom-front
      L/2,  H/2, -W/2,  // 6: right-top-back
      L/2,  H/2,  W/2,  // 7: right-top-front
    ];
  }
  
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  
  // Define faces (two triangles per face)
  const faces = [
    // Left face (or angled left face)
    0, 1, 2,  2, 1, 3,
    // Right face (or angled right face)
    4, 6, 5,  6, 7, 5,
    // Bottom face
    0, 4, 1,  1, 4, 5,
    // Top face
    2, 3, 6,  3, 7, 6,
    // Front face
    1, 5, 3,  3, 5, 7,
    // Back face
    0, 2, 4,  2, 6, 4,
  ];
  
  geom.setIndex(faces);
  geom.computeVertexNormals();
  return geom;
}

function update3DPlank() {
  if (plankMesh3d) {
    scene3d.remove(plankMesh3d);
    plankMesh3d.geometry.dispose();
    plankMesh3d.material.dispose();
  }
  if (previewGroup3d) {
    scene3d.remove(previewGroup3d);
    previewGroup3d.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    previewGroup3d = null;
  }
  
  const mat = MATERIALS[state.material];
  const L = inchesToUnits(state.stockLength);
  const W = inchesToUnits(mat.width);
  const H = inchesToUnits(mat.height);
  
  // Show the FULL plank (not cut yet)
  const geom = new THREE.BoxGeometry(L, H, W);
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.8 });
  plankMesh3d = new THREE.Mesh(geom, woodMaterial);
  plankMesh3d.castShadow = true;
  plankMesh3d.position.set(0, H/2, 0);
  
  const edges = new THREE.EdgesGeometry(geom);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x5A3A1A }));
  plankMesh3d.add(line);
  
  scene3d.add(plankMesh3d);
  
  // Adjust camera to fit the plank
  const maxDim = Math.max(L, W * 4);
  camera3d.position.set(maxDim * 0.6, maxDim * 0.5, maxDim * 0.8);
  controls3d.target.set(0, H/2, 0);
  controls3d.update();
}

function update3DPreview() {
  // Remove old preview
  if (previewGroup3d) {
    scene3d.remove(previewGroup3d);
    previewGroup3d.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  if (plankMesh3d) {
    scene3d.remove(plankMesh3d);
    plankMesh3d.geometry.dispose();
    plankMesh3d.material.dispose();
    plankMesh3d = null;
  }
  
  previewGroup3d = new THREE.Group();
  
  const mat = MATERIALS[state.material];
  const L = inchesToUnits(state.stockLength);
  const W = inchesToUnits(mat.width);
  const H = inchesToUnits(mat.height);
  const cutPos = inchesToUnits(state.cutPosition);
  const miterRad = (state.miterAngle * Math.PI) / 180;
  
  // The KEPT piece (left side - from 0 to cutPosition) - shown as solid wood
  // Angle is on the RIGHT end (where the cut happens)
  const keptGeom = createAngledBoxGeometry(cutPos, H, W, miterRad, true);
  const keptMat = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.8 });
  const keptMesh = new THREE.Mesh(keptGeom, keptMat);
  keptMesh.castShadow = true;
  // Position: left piece centered at -L/2 + cutPos/2
  keptMesh.position.set(-L/2 + cutPos/2, H/2, 0);
  
  const keptEdges = new THREE.EdgesGeometry(keptGeom);
  const keptLine = new THREE.LineSegments(keptEdges, new THREE.LineBasicMaterial({ color: 0x5A3A1A }));
  keptMesh.add(keptLine);
  previewGroup3d.add(keptMesh);
  
  // The REMAINING STOCK (right side - from cutPosition to end) - shown semi-transparent
  // Angle is on the LEFT end (where the cut happens)
  const remainLength = L - cutPos;
  const remainGeom = createAngledBoxGeometry(remainLength, H, W, miterRad, false);
  const remainMat = new THREE.MeshStandardMaterial({
    color: 0x666666, transparent: true, opacity: 0.3, roughness: 0.8
  });
  const remainMesh = new THREE.Mesh(remainGeom, remainMat);
  remainMesh.position.set(cutPos/2, H/2, 0);
  
  const remainEdges = new THREE.EdgesGeometry(remainGeom);
  const remainLine = new THREE.LineSegments(remainEdges, new THREE.LineBasicMaterial({ color: 0x444444 }));
  remainMesh.add(remainLine);
  previewGroup3d.add(remainMesh);
  
  // Cut line at the cut position (red thin plane showing the cut)
  const cutLineGeom = new THREE.BoxGeometry(0.5, H * 1.2, W * 1.2);
  const cutLineMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
  const cutLineMesh = new THREE.Mesh(cutLineGeom, cutLineMat);
  cutLineMesh.position.set(-L/2 + cutPos, H/2, 0);
  // Apply miter angle rotation
  cutLineMesh.rotation.y = -miterRad;
  previewGroup3d.add(cutLineMesh);
  
  // Add a label mesh (green wireframe box around the kept piece to highlight it)
  const highlightGeom = new THREE.BoxGeometry(cutPos + 1, H + 1, W + 1);
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const highlightMesh = new THREE.Mesh(highlightGeom, highlightMat);
  highlightMesh.position.set(-L/2 + cutPos/2, H/2, 0);
  previewGroup3d.add(highlightMesh);
  
  scene3d.add(previewGroup3d);
  
  // Adjust camera to fit the full plank
  const maxDim = Math.max(L, W * 4);
  camera3d.position.set(maxDim * 0.6, maxDim * 0.5, maxDim * 0.8);
  controls3d.target.set(0, H/2, 0);
  controls3d.update();
}

// ===== ACTIONS =====
window.switchView = function(view) {
  currentView = view;
  document.querySelectorAll('#viewToggle button').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  
  if (view === '2d') {
    canvas2d.style.display = 'block';
    canvas3d.style.display = 'none';
    draw2D();
  } else {
    canvas2d.style.display = 'none';
    canvas3d.style.display = 'block';
    // Force resize of 3D canvas after it becomes visible
    const panel = document.getElementById('centerPanel');
    canvas3d.width = panel.clientWidth;
    canvas3d.height = panel.clientHeight;
    camera3d.aspect = panel.clientWidth / panel.clientHeight;
    camera3d.updateProjectionMatrix();
    renderer3d.setSize(panel.clientWidth, panel.clientHeight);
    if (state.isPreviewing) {
      update3DPreview();
    } else {
      update3DPlank();
    }
  }
};

window.selectMaterial = function(mat) {
  state.material = mat;
  document.querySelectorAll('.material-option').forEach(o => o.classList.remove('selected'));
  document.querySelector(`[data-material="${mat}"]`).classList.add('selected');
  update3DPlank();
  if (currentView === '2d') draw2D();
};

window.setAngle = function(angle) {
  state.miterAngle = angle;
  document.getElementById('miterAngle').value = angle;
  document.getElementById('miterAngleVal').textContent = angle + '°';
  if (currentView === '2d') draw2D();
};

window.previewCut = function() {
  state.isPreviewing = true;
  // Switch to 3D first (this resizes the canvas), then update preview
  switchView('3d');
  update3DPreview();
  showToast('3D preview shown');
};

window.applyCut = function() {
  const cutPiece = { length: state.cutPosition, miterAngle: state.miterAngle, material: state.material };
  state.cutHistory.push({
    piece: cutPiece,
    stockLength: state.stockLength,
    material: state.material
  });
  state.cutPieces.push(cutPiece);
  
  // Show the CUT PIECE in 3D (the piece you keep)
  state.isPreviewing = false;
  state.showCutPiece = cutPiece; // Track which piece to show
  switchView('3d');
  showCutPiece3D(cutPiece);
  
  // Update stock for next cut
  state.stockLength = Math.max(state.stockLength - state.cutPosition, 2);
  state.cutPosition = Math.min(state.cutPosition, state.stockLength - 2);
  
  document.getElementById('stockLength').value = state.stockLength;
  document.getElementById('stockLengthVal').textContent = state.stockLength + '"';
  document.getElementById('cutPosition').value = state.cutPosition;
  document.getElementById('cutPositionVal').textContent = state.cutPosition + '"';
  
  updateCutList();
  updateSummary();
  if (currentView === '2d') draw2D();
  showToast('Cut applied! ' + cutPiece.length + '" piece at ' + cutPiece.miterAngle + '°');
};

// Show the cut piece in 3D (the piece you keep)
function showCutPiece3D(piece) {
  if (plankMesh3d) {
    scene3d.remove(plankMesh3d);
    plankMesh3d.geometry.dispose();
    plankMesh3d.material.dispose();
    plankMesh3d = null;
  }
  if (previewGroup3d) {
    scene3d.remove(previewGroup3d);
    previewGroup3d.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    previewGroup3d = null;
  }
  
  const mat = MATERIALS[piece.material];
  const L = inchesToUnits(piece.length);
  const W = inchesToUnits(mat.width);
  const H = inchesToUnits(mat.height);
  const miterRad = (piece.miterAngle * Math.PI) / 180;
  
  // Create the cut piece with angled end (angle on right side where cut happened)
  const geom = createAngledBoxGeometry(L, H, W, miterRad, true);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.8 });
  plankMesh3d = new THREE.Mesh(geom, woodMat);
  plankMesh3d.castShadow = true;
  plankMesh3d.position.set(0, H/2, 0);
  
  const edges = new THREE.EdgesGeometry(geom);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x5A3A1A }));
  plankMesh3d.add(line);
  
  scene3d.add(plankMesh3d);
  
  // Add green wireframe highlight
  const highlightGeom = new THREE.BoxGeometry(L + 2, H + 1, W + 2);
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const highlightMesh = new THREE.Mesh(highlightGeom, highlightMat);
  highlightMesh.position.set(0, H/2, 0);
  scene3d.add(highlightMesh);
  // Store for cleanup
  plankMesh3d.highlight = highlightMesh;
  
  // Camera fit
  const maxDim = Math.max(L, W * 4);
  camera3d.position.set(maxDim * 0.6, maxDim * 0.5, maxDim * 0.8);
  controls3d.target.set(0, H/2, 0);
  controls3d.update();
}

window.revertLastCut = function() {
  if (state.cutHistory.length === 0) { showToast('Nothing to revert!'); return; }
  const last = state.cutHistory.pop();
  state.cutPieces.pop();
  state.stockLength = last.stockLength;
  state.material = last.material;
  document.getElementById('stockLength').value = state.stockLength;
  document.getElementById('stockLengthVal').textContent = state.stockLength + '"';
  update3DPlank();
  updateCutList();
  updateSummary();
  if (currentView === '2d') draw2D();
  showToast('Reverted!');
};

window.toggleLabels = function() {
  state.showLabels = !state.showLabels;
  const btn = document.getElementById('toggleLabels');
  btn.textContent = state.showLabels ? '📏 Labels: ON' : '📏 Labels: OFF';
  if (currentView === '2d') draw2D();
};

window.clearAll = function() {
  state.cutPieces = [];
  state.cutHistory = [];
  state.stockLength = 96;
  state.cutPosition = 48;
  state.miterAngle = 0;
  document.getElementById('stockLength').value = 96;
  document.getElementById('stockLengthVal').textContent = '96"';
  document.getElementById('cutPosition').value = 48;
  document.getElementById('cutPositionVal').textContent = '48"';
  document.getElementById('miterAngle').value = 0;
  document.getElementById('miterAngleVal').textContent = '0°';
  state.isPreviewing = false;
  update3DPlank();
  updateCutList();
  updateSummary();
  if (currentView === '2d') draw2D();
  showToast('Cleared!');
};

function updateCutList() {
  const container = document.getElementById('cutPieces');
  container.innerHTML = '';
  state.cutPieces.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'cut-piece';
    div.innerHTML = `<span class="piece-length">${p.length}"</span><span class="piece-angle">${p.miterAngle}°</span>`;
    container.appendChild(div);
  });
  document.getElementById('pieceCount').textContent = state.cutPieces.length;
}

function updateSummary() {
  const total = state.cutPieces.reduce((s, p) => s + p.length, 0);
  const waste = Math.max(0, state.stockLength - total);
  document.getElementById('totalPieces').textContent = state.cutPieces.length;
  document.getElementById('totalLength').textContent = total.toFixed(1) + '"';
  document.getElementById('wasteLength').textContent = waste.toFixed(1) + '"';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

document.getElementById('stockLength').addEventListener('input', e => {
  state.stockLength = parseInt(e.target.value);
  document.getElementById('stockLengthVal').textContent = state.stockLength + '"';
  document.getElementById('cutPosition').max = state.stockLength - 2;
  update3DPlank();
  updateSummary();
  if (currentView === '2d') draw2D();
});

document.getElementById('miterAngle').addEventListener('input', e => {
  state.miterAngle = parseFloat(e.target.value);
  document.getElementById('miterAngleVal').textContent = state.miterAngle + '°';
  if (currentView === '2d') draw2D();
});

document.getElementById('cutPosition').addEventListener('input', e => {
  state.cutPosition = parseFloat(e.target.value);
  document.getElementById('cutPositionVal').textContent = state.cutPosition + '"';
  if (currentView === '2d') draw2D();
});

init();