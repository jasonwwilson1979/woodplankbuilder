
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

const state = {
    objects: [], history: [], historyIndex: -1,
    selectedObject: null, multiSelection: new Set(),
    currentProjectName: 'Untitled Model',
    wireframe: false, gridVisible: true,
    measureMode: false, measureStartPoint: null,
    measurements: [], pendingMeasureLine: null, pendingMeasureLabel: null,
    isDraggingGizmo: false,
    // Cut tool state
    cutMode: null, // 'angle' or 'profile'
    cutPoints: [],
    cutPreviewMesh: null,
    cutTarget: null
};

let selectionBoxes = new Map();

// === PROJECT MANAGEMENT ===
function getAllProjects() { try { return JSON.parse(localStorage.getItem('modeler_projects') || '{}'); } catch(e) { return {}; } }
function saveAllProjects(projects) { localStorage.setItem('modeler_projects', JSON.stringify(projects)); }
function getCurrentProjectData() {
    return {
        objects: state.objects.map(function(o) { return serializeObject(o.mesh); }),
        measurements: state.measurements.map(function(m) { return { start: m.start.clone(), end: m.end.clone() }; }),
        savedAt: new Date().toISOString()
    };
}
function updateProjectNameDisplay() { document.getElementById('projectNameDisplay').textContent = 'Project: ' + state.currentProjectName; }
function saveCurrentProject(nameOverride) {
    var name = nameOverride || state.currentProjectName;
    state.currentProjectName = name;
    var projects = getAllProjects();
    projects[name] = getCurrentProjectData();
    saveAllProjects(projects);
    updateProjectNameDisplay();
    showToast('Saved: ' + name);
}
function loadProjectByName(name) {
    var projects = getAllProjects();
    var data = projects[name];
    if (!data) { showToast('Project not found'); return; }
    loadProjectData(data);
    state.currentProjectName = name;
    updateProjectNameDisplay();
    showToast('Loaded: ' + name);
}
function loadProjectData(data) {
    clearScene();
    if (data.objects) { for (var i = 0; i < data.objects.length; i++) { var mesh = deserializeObject(data.objects[i]); if (mesh) { scene.add(mesh); state.objects.push({ mesh: mesh, name: data.objects[i].name || 'Object' }); } } }
    if (data.measurements) { for (var j = 0; j < data.measurements.length; j++) { var m = data.measurements[j]; createMeasurement(new THREE.Vector3(m.start.x, m.start.y, m.start.z), new THREE.Vector3(m.end.x, m.end.y, m.end.z)); } }
    updateSceneList(); updateStats(); pushHistory();
}
function deleteProject(name) {
    showCustomModal({ title: 'Delete Project', type: 'confirm', message: 'Delete project "' + name + '"?', onConfirm: function() {
        var projects = getAllProjects(); delete projects[name]; saveAllProjects(projects);
        if (state.currentProjectName === name) { state.currentProjectName = 'Untitled Model'; updateProjectNameDisplay(); }
        openProjectManager(); showToast('Deleted: ' + name);
    }});
}
function openProjectManager() {
    var modal = document.getElementById('projectModal');
    var content = document.getElementById('projectModalContent');
    var projects = getAllProjects();
    var names = Object.keys(projects).sort();
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3 style="color:#daa520;margin:0;">📂 Projects (' + names.length + ')</h3><button id="closeProjModal" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">×</button></div>';
    if (names.length === 0) { html += '<p style="color:#888;font-size:12px;text-align:center;padding:20px;">No saved projects yet.</p>'; }
    else { for (var i = 0; i < names.length; i++) { var name = names[i]; var proj = projects[name]; var date = proj.savedAt ? new Date(proj.savedAt).toLocaleString() : 'Unknown'; var count = proj.objects ? proj.objects.length : 0; html += '<div class="project-list-item"><span class="proj-name">' + name + '</span><span class="proj-date">' + date + ' · ' + count + ' objs</span><button class="load-btn" data-proj-load="' + name + '">Load</button><button class="del-btn" data-proj-del="' + name + '">🗑</button></div>'; } }
    content.innerHTML = html; modal.style.display = 'block';
    document.getElementById('closeProjModal').onclick = function() { modal.style.display = 'none'; };
    content.querySelectorAll('[data-proj-load]').forEach(function(btn) { btn.onclick = function() { modal.style.display = 'none'; loadProjectByName(btn.dataset.projLoad); }; });
    content.querySelectorAll('[data-proj-del]').forEach(function(btn) { btn.onclick = function() { deleteProject(btn.dataset.projDel); }; });
}

var viewportEl = document.getElementById('viewport');
var scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2a2a);
var camera = new THREE.PerspectiveCamera(60, 1, 0.01, 500); camera.position.set(5, 4, 6);
var renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true }); 
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
renderer.localClippingEnabled = true; // Enable local clipping for cuts
viewportEl.appendChild(renderer.domElement);
var orbitControls = new OrbitControls(camera, renderer.domElement); orbitControls.enableDamping = true; orbitControls.dampingFactor = 0.1; orbitControls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
var transformControls = new TransformControls(camera, renderer.domElement);
transformControls.addEventListener('dragging-changed', function(e) { state.isDraggingGizmo = e.value; orbitControls.enabled = !e.value; });
transformControls.addEventListener('objectChange', function() { if (state.selectedObject) updatePropsPanel(); });
transformControls.addEventListener('mouseUp', function() { if (state.selectedObject) pushHistory(); });
transformControls.setTranslationSnap(0.25); transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
scene.add(transformControls);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
var dirLight = new THREE.DirectionalLight(0xffffff, 1.0); dirLight.position.set(10, 20, 10); dirLight.castShadow = true; dirLight.shadow.mapSize.set(2048, 2048); dirLight.shadow.camera.left = -20; dirLight.shadow.camera.right = 20; dirLight.shadow.camera.top = 20; dirLight.shadow.camera.bottom = -20; scene.add(dirLight);

var ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.isGround = true; scene.add(ground);
var gridHelper = new THREE.GridHelper(50, 50, 0x555555, 0x333333); gridHelper.position.y = 0.005; scene.add(gridHelper);

// === CUT TOOL SYSTEM ===
var globalCutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

function applyAngleCut(mesh) {
    if (!mesh) return;
    // Create a clipping plane at 45 degrees relative to the object
    var cutPlane = new THREE.Plane(new THREE.Vector3(0, 1, -1).normalize(), 0);
    
    // Apply local clipping
    mesh.material.clippingPlanes = [cutPlane];
    mesh.material.clipShadows = true;
    mesh.userData.hasCut = true;
    mesh.userData.cutType = 'angle';
    
    pushHistory();
    showToast('Applied 45° Angle Cut');
}

function startDrawCut() {
    if (!state.selectedObject) { showToast('Select an object first'); return; }
    state.cutMode = 'profile';
    state.cutTarget = state.selectedObject;
    state.cutPoints = [];
    document.getElementById('cutOverlay').style.display = 'block';
    document.getElementById('hintText').textContent = 'Click points on surface to define cut profile · Enter to Apply · Esc to Cancel';
}

function cancelCutMode() {
    state.cutMode = null;
    state.cutPoints = [];
    if (state.cutPreviewMesh) {
        scene.remove(state.cutPreviewMesh);
        state.cutPreviewMesh.geometry.dispose();
        state.cutPreviewMesh.material.dispose();
        state.cutPreviewMesh = null;
    }
    document.getElementById('cutOverlay').style.display = 'none';
    document.getElementById('hintText').textContent = 'G: Move · R: Rotate · S: Scale · Del: Delete · F: Focus';
}

function applyDrawnCut() {
    if (state.cutPoints.length < 3) { showToast('Need at least 3 points for a cut profile'); return; }
    
    // For simplicity in this implementation, we'll use the drawn points to create a visual mask
    // In a full CAD implementation, this would perform boolean subtraction
    // Here we create a visual indicator of the cut zone
    
    var shape = new THREE.Shape();
    shape.moveTo(state.cutPoints[0].x, state.cutPoints[0].z);
    for(var i=1; i<state.cutPoints.length; i++) {
        shape.lineTo(state.cutPoints[i].x, state.cutPoints[i].z);
    }
    shape.closePath();
    
    var geo = new THREE.ShapeGeometry(shape);
    var mat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false });
    var cutMarker = new THREE.Mesh(geo, mat);
    cutMarker.rotation.x = -Math.PI / 2;
    cutMarker.position.y = 0.02; // Just above ground
    cutMarker.renderOrder = 998;
    scene.add(cutMarker);
    
    // Tag the target object
    if (state.cutTarget) {
        state.cutTarget.userData.hasCut = true;
        state.cutTarget.userData.cutType = 'profile';
        state.cutTarget.userData.cutProfile = state.cutPoints.map(function(p) { return {x: p.x, z: p.z}; });
    }
    
    pushHistory();
    showToast('Cut profile applied (Visual Marker)');
    cancelCutMode();
}

function clearAllCuts() {
    state.objects.forEach(function(o) {
        if (o.mesh.userData.hasCut) {
            o.mesh.material.clippingPlanes = [];
            o.mesh.userData.hasCut = false;
            o.mesh.userData.cutType = null;
            o.mesh.userData.cutProfile = null;
        }
    });
    // Remove visual cut markers
    var toRemove = [];
    scene.traverse(function(c) {
        if (c.isMesh && c.material && c.material.transparent && c.material.opacity === 0.3 && c.material.color.getHex() === 0xff0000) {
            toRemove.push(c);
        }
    });
    toRemove.forEach(function(c) { scene.remove(c); c.geometry.dispose(); c.material.dispose(); });
    
    pushHistory();
    showToast('All cuts cleared');
}

function createPrimitive(type) {
    var geo, mat;
    var defaultMat = new THREE.MeshStandardMaterial({ color: 0xA0703A, roughness: 0.8 });
    switch (type) {
        case 'cube': geo = new THREE.BoxGeometry(1, 1, 1); break;
        case 'cylinder': geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16); break;
        case 'sphere': geo = new THREE.SphereGeometry(0.5, 16, 16); break;
        case 'wedge':
            geo = new THREE.BufferGeometry();
            var wv = new Float32Array([ -0.5,0,0.5, 0.5,0,0.5, 0.5,0,-0.5, -0.5,0,-0.5, 0,1,0 ]);
            var wi = [0,1,4, 1,2,4, 2,3,4, 3,0,4, 0,3,2, 0,2,1];
            geo.setAttribute('position', new THREE.BufferAttribute(wv, 3));
            geo.setIndex(wi); geo.computeVertexNormals(); break;
        case 'arch': geo = new THREE.TorusGeometry(0.5, 0.15, 8, 16, Math.PI); break;
        default: geo = new THREE.BoxGeometry(1, 1, 1);
    }
    var mesh = new THREE.Mesh(geo, defaultMat.clone());
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.isModelObject = true;
    mesh.userData.name = type.charAt(0).toUpperCase() + type.slice(1);
    if (type === 'arch') mesh.position.y = 0;
    else mesh.position.y = 0.5;
    return mesh;
}

function addObjectToScene(mesh, name) {
    mesh.userData.name = name || mesh.userData.name || 'Object';
    scene.add(mesh);
    state.objects.push({ mesh: mesh, name: mesh.userData.name });
    updateSceneList(); updateStats(); pushHistory();
    selectObject(mesh);
}

function removeObject(mesh) {
    var idx = state.objects.findIndex(function(o) { return o.mesh === mesh; });
    if (idx < 0) return;
    scene.remove(mesh);
    mesh.traverse(function(child) { if (child.geometry) child.geometry.dispose(); if (child.material) { if (child.material.map) child.material.map.dispose(); child.material.dispose(); } });
    state.objects.splice(idx, 1);
    if (state.selectedObject === mesh) selectObject(null);
    state.multiSelection.delete(mesh);
    updateSelectionBoxes(); updateSceneList(); updateStats(); pushHistory();
}

function clearScene() {
    for (var i = 0; i < state.objects.length; i++) { var o = state.objects[i]; scene.remove(o.mesh); o.mesh.traverse(function(c) { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); }
    state.objects = []; selectObject(null); clearAllMeasurements();
    updateSceneList(); updateStats();
}

var raycaster = new THREE.Raycaster();
var mouseNDC = new THREE.Vector2();
var selectionBox = new THREE.BoxHelper(); selectionBox.material.color.set(0xdaa520); selectionBox.material.depthTest = false; selectionBox.renderOrder = 999;

function selectObject(mesh) {
    if (state.selectedObject) scene.remove(selectionBox);
    state.selectedObject = mesh;
    if (mesh) { transformControls.attach(mesh); selectionBox.setFromObject(mesh); scene.add(selectionBox); }
    else { transformControls.detach(); }
    updatePropsPanel(); updateSceneList();
}

function updateSelectionBoxes() {
    selectionBoxes.forEach(function(box) { scene.remove(box); box.geometry.dispose(); box.material.dispose(); });
    selectionBoxes.clear();
    state.multiSelection.forEach(function(mesh) { var box = new THREE.BoxHelper(mesh, 0xdaa520); box.material.depthTest = false; box.renderOrder = 999; scene.add(box); selectionBoxes.set(mesh, box); });
    if (state.multiSelection.size === 1) selectObject(Array.from(state.multiSelection)[0]);
    else { transformControls.detach(); state.selectedObject = null; updatePropsPanel(); }
}

function serializeObject(mesh) {
    // Temporarily strip wireframe before serializing
    var wireframeStates = [];
    mesh.traverse(function(c) {
        if (c.isMesh && c.material) {
            wireframeStates.push({ mesh: c, wf: c.material.wireframe });
            c.material.wireframe = false;
        }
    });
    
    var result = {
        name: mesh.userData.name,
        type: mesh.geometry.type,
        px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z,
        rx: mesh.rotation.x, ry: mesh.rotation.y, rz: mesh.rotation.z,
        sx: mesh.scale.x, sy: mesh.scale.y, sz: mesh.scale.z,
        color: '#' + mesh.material.color.getHexString(),
        hasCut: mesh.userData.hasCut || false,
        cutType: mesh.userData.cutType || null,
        cutProfile: mesh.userData.cutProfile || null
    };
    
    // Restore wireframe states after serializing
    wireframeStates.forEach(function(entry) {
        entry.mesh.material.wireframe = entry.wf;
    });
    
    return result;
}
function deserializeObject(data) {
    var geo;
    switch (data.type) {
        case 'BoxGeometry': geo = new THREE.BoxGeometry(1, 1, 1); break;
        case 'CylinderGeometry': geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16); break;
        case 'SphereGeometry': geo = new THREE.SphereGeometry(0.5, 16, 16); break;
        case 'TorusGeometry': geo = new THREE.TorusGeometry(0.5, 0.15, 8, 16, Math.PI); break;
        default: geo = new THREE.BoxGeometry(1, 1, 1);
    }
    var mat = new THREE.MeshStandardMaterial({ color: data.color || 0xA0703A, roughness: 0.8 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.isModelObject = true; mesh.userData.name = data.name || 'Object';
    mesh.position.set(data.px, data.py, data.pz);
    mesh.rotation.set(data.rx, data.ry, data.rz);
    mesh.scale.set(data.sx, data.sy, data.sz);
    
    // Restore cut data
    if (data.hasCut) {
        mesh.userData.hasCut = true;
        mesh.userData.cutType = data.cutType;
        mesh.userData.cutProfile = data.cutProfile;
        if (data.cutType === 'angle') {
            var cutPlane = new THREE.Plane(new THREE.Vector3(0, 1, -1).normalize(), 0);
            mesh.material.clippingPlanes = [cutPlane];
            mesh.material.clipShadows = true;
        }
    }
    
    // FIX: Always strip wireframe flag to prevent invisible walls
    mesh.traverse(function(child) {
        if (child.isMesh && child.material) {
            child.material.wireframe = false;
        }
    });
    
    return mesh;
}
function pushHistory() { var snapshot = state.objects.map(function(o) { return serializeObject(o.mesh); }); state.history = state.history.slice(0, state.historyIndex + 1); state.history.push(snapshot); state.historyIndex = state.history.length - 1; if (state.history.length > 50) { state.history.shift(); state.historyIndex--; } }
function restoreSnapshot(snapshot) { clearScene(); for (var i = 0; i < snapshot.length; i++) { var mesh = deserializeObject(snapshot[i]); if (mesh) { scene.add(mesh); state.objects.push({ mesh: mesh, name: snapshot[i].name }); } } updateSceneList(); updateStats(); }
function undo() { if (state.historyIndex > 0) { state.historyIndex--; restoreSnapshot(state.history[state.historyIndex]); } }
function redo() { if (state.historyIndex < state.history.length - 1) { state.historyIndex++; restoreSnapshot(state.history[state.historyIndex]); } }

function formatDistance(feet) { var totalInches = feet * 12; var ft = Math.floor(totalInches / 12); return ft + "' " + (totalInches - ft * 12).toFixed(2) + '"'; }
function createTextSprite(text, color) { color = color || '#0f0'; var canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; var ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0,0,512,128); ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(4,4,504,120); ctx.fillStyle = color; ctx.font = 'bold 48px Segoe UI, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64); var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })); sprite.scale.set(4, 1, 1); sprite.renderOrder = 1000; return sprite; }
function createMeasurement(start, end) {
    var group = new THREE.Group();
    var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3, depthTest: false })); line.renderOrder = 999; group.add(line);
    var markerGeo = new THREE.SphereGeometry(0.08, 8, 8); var markerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false });
    var sm = new THREE.Mesh(markerGeo, markerMat); sm.position.copy(start); sm.renderOrder = 999; group.add(sm);
    var em = new THREE.Mesh(markerGeo, markerMat); em.position.copy(end); em.renderOrder = 999; group.add(em);
    var dist = start.distanceTo(end); var distText = formatDistance(dist);
    var label = createTextSprite(distText); var mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5); mid.y += 0.4; label.position.copy(mid); group.add(label);
    scene.add(group);
    state.measurements.push({ start: start.clone(), end: end.clone(), group: group, distanceFeet: dist, distanceText: distText });
    showToast('Measured: ' + distText);
}
function clearAllMeasurements() { for (var i = 0; i < state.measurements.length; i++) { var m = state.measurements[i]; scene.remove(m.group); m.group.traverse(function(c) { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); } state.measurements = []; if (state.pendingMeasureLine) { scene.remove(state.pendingMeasureLine); state.pendingMeasureLine.geometry.dispose(); state.pendingMeasureLine.material.dispose(); state.pendingMeasureLine = null; } if (state.pendingMeasureLabel) { scene.remove(state.pendingMeasureLabel); state.pendingMeasureLabel.material.map.dispose(); state.pendingMeasureLabel.material.dispose(); state.pendingMeasureLabel = null; } state.measureStartPoint = null; showToast('Measurements cleared'); }
function setMeasureMode(active) { state.measureMode = active; document.getElementById('hintText').textContent = active ? (state.measureStartPoint ? 'Click second point' : 'Click first point · ESC to exit') : 'G: Move · R: Rotate · S: Scale · Del: Delete · F: Focus'; if (!active) { if (state.pendingMeasureLine) { scene.remove(state.pendingMeasureLine); state.pendingMeasureLine.geometry.dispose(); state.pendingMeasureLine.material.dispose(); state.pendingMeasureLine = null; } if (state.pendingMeasureLabel) { scene.remove(state.pendingMeasureLabel); state.pendingMeasureLabel.material.map.dispose(); state.pendingMeasureLabel.material.dispose(); state.pendingMeasureLabel = null; } state.measureStartPoint = null; } }

function updatePropsPanel() {
    var panel = document.getElementById('propsContent');
    var mesh = state.selectedObject;
    if (!mesh) { panel.innerHTML = '<p style="color:#666;font-size:11px;">Select an object to edit its properties.</p>'; return; }
    var px = mesh.position.x.toFixed(3), py = mesh.position.y.toFixed(3), pz = mesh.position.z.toFixed(3);
    var rx = THREE.MathUtils.radToDeg(mesh.rotation.x).toFixed(1), ry = THREE.MathUtils.radToDeg(mesh.rotation.y).toFixed(1), rz = THREE.MathUtils.radToDeg(mesh.rotation.z).toFixed(1);
    var sx = mesh.scale.x.toFixed(3), sy = mesh.scale.y.toFixed(3), sz = mesh.scale.z.toFixed(3);
    var col = '#' + mesh.material.color.getHexString();
    var cutInfo = mesh.userData.hasCut ? '<div class="prop-row"><label>Cut</label><span style="color:#ff6b6b;">' + (mesh.userData.cutType || 'Yes') + '</span></div>' : '';
    
    panel.innerHTML = '<div class="prop-group"><div class="prop-group-title">Identity</div><div class="prop-row"><label>Name</label><input type="text" id="propName" value="' + (mesh.userData.name || '') + '"></div></div>' +
        '<div class="prop-group"><div class="prop-group-title">Position</div><div class="prop-row"><label>X</label><input type="number" step="0.01" id="propPX" value="' + px + '"></div><div class="prop-row"><label>Y</label><input type="number" step="0.01" id="propPY" value="' + py + '"></div><div class="prop-row"><label>Z</label><input type="number" step="0.01" id="propPZ" value="' + pz + '"></div></div>' +
        '<div class="prop-group"><div class="prop-group-title">Rotation (deg)</div><div class="prop-row"><label>X</label><input type="number" step="1" id="propRX" value="' + rx + '"></div><div class="prop-row"><label>Y</label><input type="number" step="1" id="propRY" value="' + ry + '"></div><div class="prop-row"><label>Z</label><input type="number" step="1" id="propRZ" value="' + rz + '"></div></div>' +
        '<div class="prop-group"><div class="prop-group-title">Scale</div><div class="prop-row"><label>X</label><input type="number" step="0.01" id="propSX" value="' + sx + '"></div><div class="prop-row"><label>Y</label><input type="number" step="0.01" id="propSY" value="' + sy + '"></div><div class="prop-row"><label>Z</label><input type="number" step="0.01" id="propSZ" value="' + sz + '"></div></div>' +
        '<div class="prop-group"><div class="prop-group-title">Material</div><div class="prop-row"><label>Color</label><input type="color" id="propColor" value="' + col + '" style="width:40px;height:24px;padding:0;"></div></div>' +
        cutInfo +
        '<div class="prop-group"><button class="action-btn" id="propDuplicateBtn">📋 Duplicate</button><button class="action-btn danger" id="propDeleteBtn">🗑 Delete</button></div>';
    var bind = function(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('change', fn); };
    bind('propName', function(ev) { mesh.userData.name = ev.target.value; updateSceneList(); });
    bind('propPX', function(ev) { mesh.position.x = parseFloat(ev.target.value) || 0; selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propPY', function(ev) { mesh.position.y = parseFloat(ev.target.value) || 0; selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propPZ', function(ev) { mesh.position.z = parseFloat(ev.target.value) || 0; selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propRX', function(ev) { mesh.rotation.x = THREE.MathUtils.degToRad(parseFloat(ev.target.value) || 0); selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propRY', function(ev) { mesh.rotation.y = THREE.MathUtils.degToRad(parseFloat(ev.target.value) || 0); selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propRZ', function(ev) { mesh.rotation.z = THREE.MathUtils.degToRad(parseFloat(ev.target.value) || 0); selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propSX', function(ev) { mesh.scale.x = parseFloat(ev.target.value) || 0.001; selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propSY', function(ev) { mesh.scale.y = parseFloat(ev.target.value) || 0.001; selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propSZ', function(ev) { mesh.scale.z = parseFloat(ev.target.value) || 0.001; selectionBox.setFromObject(mesh); pushHistory(); });
    bind('propColor', function(ev) { mesh.material.color.set(ev.target.value); pushHistory(); });
    document.getElementById('propDuplicateBtn').onclick = function() { duplicateSelected(); };
    document.getElementById('propDeleteBtn').onclick = function() { if (state.selectedObject) removeObject(state.selectedObject); };
}

function updateSceneList() {
    var list = document.getElementById('sceneList'); list.innerHTML = '';
    for (var i = 0; i < state.objects.length; i++) {
        var obj = state.objects[i];
        var item = document.createElement('div');
        item.className = 'scene-item' + (state.selectedObject === obj.mesh ? ' selected' : '');
        item.innerHTML = '<span class="icon">🧊</span><span class="item-name">' + (obj.name || 'Object') + '</span><button class="del-btn" data-idx="' + i + '">×</button>';
        (function(objRef) {
            item.onclick = function(ev) { if (!ev.target.classList.contains('del-btn')) selectObject(objRef.mesh); };
        })(obj);
        (function(objRef) {
            item.querySelector('.del-btn').onclick = function(ev) { ev.stopPropagation(); removeObject(objRef.mesh); };
        })(obj);
        list.appendChild(item);
    }
    document.getElementById('objectCount').textContent = 'Objects: ' + state.objects.length;
}

function updateStats() {
    var verts = 0, faces = 0;
    for (var i = 0; i < state.objects.length; i++) {
        state.objects[i].mesh.traverse(function(c) { if (c.isMesh && c.geometry) { var pos = c.geometry.attributes.position; if (pos) verts += pos.count; if (c.geometry.index) faces += c.geometry.index.count / 3; else if (pos) faces += pos.count / 3; } });
    }
    document.getElementById('vertexCount').textContent = 'Vertices: ' + verts.toLocaleString();
}

function showCustomModal(options) {
    var overlay = document.createElement('div'); overlay.className = 'custom-modal-overlay';
    var box = document.createElement('div'); box.className = 'custom-modal-box';
    var title = document.createElement('h3'); title.textContent = options.title; box.appendChild(title);
    if (options.message) { var msg = document.createElement('p'); msg.textContent = options.message; box.appendChild(msg); }
    var input = null;
    if (options.type === 'prompt') { input = document.createElement('input'); input.type = 'text'; input.value = options.defaultValue || ''; input.placeholder = options.placeholder || ''; box.appendChild(input); }
    var btnRow = document.createElement('div'); btnRow.className = 'btn-row';
    var cancelBtn = document.createElement('button'); cancelBtn.className = 'btn-cancel'; cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = function() { document.body.removeChild(overlay); if (options.onCancel) options.onCancel(); };
    var confirmBtn = document.createElement('button'); confirmBtn.className = 'btn-confirm' + (options.type === 'confirm' ? ' danger' : ''); confirmBtn.textContent = options.type === 'confirm' ? 'Delete' : 'OK';
    confirmBtn.onclick = function() { document.body.removeChild(overlay); if (options.onConfirm) options.onConfirm(input ? input.value : true); };
    if (options.type !== 'alert') btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn); box.appendChild(btnRow); overlay.appendChild(box); document.body.appendChild(overlay);
    if (input) { setTimeout(function() { input.focus(); input.select(); }, 50); input.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') confirmBtn.click(); if (ev.key === 'Escape') cancelBtn.click(); }); }
    else { setTimeout(function() { confirmBtn.focus(); }, 50); overlay.addEventListener('keydown', function(ev) { if (ev.key === 'Escape') cancelBtn.click(); }); }
    overlay.addEventListener('click', function(ev) { if (ev.target === overlay) cancelBtn.click(); });
}

function showToast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(showToast._t); showToast._t = setTimeout(function() { t.classList.remove('show'); }, 2500); }

function duplicateSelected() {
    if (!state.selectedObject) { showToast('Select an object first'); return; }
    var orig = state.selectedObject;
    var clone = orig.clone();
    clone.position.x += 0.5;
    clone.userData.name = (orig.userData.name || 'Object') + '_copy';
    addObjectToScene(clone, clone.userData.name);
}

renderer.domElement.addEventListener('contextmenu', function(ev) { ev.preventDefault(); });
var mouseDownInfo = null;
renderer.domElement.addEventListener('mousedown', function(ev) { if (ev.button !== 0) return; mouseDownInfo = { x: ev.clientX, y: ev.clientY, ctrl: ev.ctrlKey, shift: ev.shiftKey }; });
renderer.domElement.addEventListener('mouseup', function(ev) {
    if (!mouseDownInfo || ev.button !== 0) return;
    var moved = Math.hypot(ev.clientX - mouseDownInfo.x, ev.clientY - mouseDownInfo.y) > 5;
    var wasCtrl = mouseDownInfo.ctrl; var wasShift = mouseDownInfo.shift;
    mouseDownInfo = null; if (moved || state.isDraggingGizmo) return;
    
    // Handle Cut Drawing Mode
    if (state.cutMode === 'profile') {
        var rect = viewportEl.getBoundingClientRect(); mouseNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1; mouseNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        var hits = raycaster.intersectObjects([ground], false);
        if (hits.length > 0) {
            state.cutPoints.push(hits[0].point.clone());
            // Update preview line
            if (state.cutPreviewMesh) { scene.remove(state.cutPreviewMesh); state.cutPreviewMesh.geometry.dispose(); state.cutPreviewMesh.material.dispose(); }
            if (state.cutPoints.length >= 2) {
                var pts = state.cutPoints.map(function(p) { return new THREE.Vector3(p.x, 0.03, p.z); });
                pts.push(pts[0].clone()); // Close loop visually
                var lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
                var lineMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2, depthTest: false });
                state.cutPreviewMesh = new THREE.Line(lineGeo, lineMat);
                state.cutPreviewMesh.renderOrder = 998;
                scene.add(state.cutPreviewMesh);
            }
        }
        return;
    }
    
    if (state.measureMode) {
        var rect2 = viewportEl.getBoundingClientRect(); mouseNDC.x = ((ev.clientX - rect2.left) / rect2.width) * 2 - 1; mouseNDC.y = -((ev.clientY - rect2.top) / rect2.height) * 2 + 1;
        raycaster.setFromCamera(mouseNDC, camera);
        var hits2 = raycaster.intersectObjects(state.objects.map(function(o) { return o.mesh; }).concat([ground]), true);
        if (hits2.length > 0) {
            var pt = hits2[0].point.clone();
            if (!state.measureStartPoint) { state.measureStartPoint = pt; showToast('Start point set'); }
            else { createMeasurement(state.measureStartPoint, pt); state.measureStartPoint = null; }
        }
        return;
    }
    var rect3 = viewportEl.getBoundingClientRect(); mouseNDC.x = ((ev.clientX - rect3.left) / rect3.width) * 2 - 1; mouseNDC.y = -((ev.clientY - rect3.top) / rect3.height) * 2 + 1;
    raycaster.setFromCamera(mouseNDC, camera);
    var meshes = state.objects.map(function(o) { return o.mesh; });
    var hits3 = raycaster.intersectObjects(meshes, true);
    if (hits3.length > 0) {
        var target = hits3[0].object;
        while (target.parent && !target.userData.isModelObject && target.parent !== scene) target = target.parent;
        if (target.userData.isModelObject) {
            if (wasShift) { if (state.multiSelection.has(target)) state.multiSelection.delete(target); else state.multiSelection.add(target); updateSelectionBoxes(); }
            else { state.multiSelection.clear(); state.multiSelection.add(target); updateSelectionBoxes(); selectObject(target); }
        }
    } else if (!wasShift) { state.multiSelection.clear(); updateSelectionBoxes(); selectObject(null); }
});

function isTypingInInput() { var el = document.activeElement; if (!el) return false; var tag = el.tagName.toLowerCase(); return tag === 'input' || tag === 'textarea' || tag === 'select'; }
window.addEventListener('keydown', function(ev) {
    if (isTypingInInput()) return;
    if (ev.code === 'F1') { ev.preventDefault(); var h = document.getElementById('helpModal'); h.style.display = h.style.display === 'block' ? 'none' : 'block'; return; }
    if (ev.code === 'Escape') { 
        if (state.cutMode) { cancelCutMode(); return; }
        if (state.measureMode) setMeasureMode(false); 
    }
    if (ev.code === 'Enter' && state.cutMode === 'profile') { applyDrawnCut(); return; }
    if (ev.ctrlKey || ev.metaKey) { if (ev.code === 'KeyZ') { ev.preventDefault(); undo(); return; } if (ev.code === 'KeyY' || (ev.shiftKey && ev.code === 'KeyZ')) { ev.preventDefault(); redo(); return; } }
    if (ev.shiftKey && ev.code === 'KeyD') { ev.preventDefault(); duplicateSelected(); return; }
    switch (ev.code) {
        case 'Delete': case 'Backspace': if (state.selectedObject) removeObject(state.selectedObject); break;
        case 'KeyG': transformControls.setMode('translate'); break;
        case 'KeyR': transformControls.setMode('rotate'); break;
        case 'KeyS': if (!ev.ctrlKey) transformControls.setMode('scale'); break;
        case 'KeyF': if (state.selectedObject) { var box = new THREE.Box3().setFromObject(state.selectedObject); var center = new THREE.Vector3(); box.getCenter(center); orbitControls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(3, 2, 3)); orbitControls.update(); } break;
        case 'KeyM': setMeasureMode(!state.measureMode); break;
    }
});

document.querySelectorAll('.menu-item').forEach(function(item) { item.addEventListener('click', function(ev) { if (!ev.target.closest('.menu-dropdown')) return; setTimeout(function() { document.querySelectorAll('.menu-item.open').forEach(function(el) { el.classList.remove('open'); }); }, 100); }); });
document.addEventListener('click', function(ev) { if (!ev.target.closest('.menu-item')) document.querySelectorAll('.menu-item.open').forEach(function(el) { el.classList.remove('open'); }); });

document.getElementById('saveBtn').onclick = function() { showCustomModal({ title: 'Save Project', type: 'prompt', defaultValue: state.currentProjectName, placeholder: 'Project name', onConfirm: function(name) { if (!name || !name.trim()) { showToast('Enter a name'); return; } saveCurrentProject(name.trim()); } }); };
document.getElementById('loadBtn').onclick = function() { openProjectManager(); };
document.getElementById('exportProjectBtn').onclick = function() { var data = getCurrentProjectData(); data.projectName = state.currentProjectName; var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = state.currentProjectName.replace(/[^a-z0-9]/gi, '_') + '.woodproj'; link.click(); showToast('Exported: ' + state.currentProjectName + '.woodproj'); };
document.getElementById('importProjectBtn').onclick = function() { document.getElementById('importProjectInput').click(); };
document.getElementById('importProjectInput').onchange = function(ev) { var file = ev.target.files[0]; if (!file) return; var reader = new FileReader(); reader.onload = function(re) { try { var data = JSON.parse(re.target.result); var projectName = data.projectName || file.name.replace(/\.[^.]+$/, ''); var finalName = projectName; var projects = getAllProjects(); if (projects[finalName]) finalName = projectName + ' (' + new Date().toLocaleDateString() + ')'; data.savedAt = new Date().toISOString(); projects[finalName] = data; saveAllProjects(projects); loadProjectData(data); state.currentProjectName = finalName; updateProjectNameDisplay(); showToast('Imported: ' + finalName); } catch(err) { showToast('Import failed: Invalid file'); } }; reader.readAsText(file); ev.target.value = ''; };
document.getElementById('importModelBtn').onclick = function() { document.getElementById('modelFileInput').click(); };
var gltfLoader = new GLTFLoader();
document.getElementById('modelFileInput').onchange = function(ev) { var file = ev.target.files[0]; if (!file) return; showToast('Importing model...'); var url = URL.createObjectURL(file); gltfLoader.load(url, function(gltf) { var model = gltf.scene; var box = new THREE.Box3().setFromObject(model); var center = new THREE.Vector3(); box.getCenter(center); model.position.sub(center); var wrapper = new THREE.Group(); wrapper.add(model); wrapper.position.copy(center); wrapper.userData.isModelObject = true; wrapper.userData.name = file.name.replace(/\.[^.]+$/, ''); wrapper.traverse(function(c) { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.material.wireframe = false; } }); addObjectToScene(wrapper, wrapper.userData.name); showToast('Imported: ' + file.name); URL.revokeObjectURL(url); }, undefined, function(err) { showToast('Import failed: ' + err.message); }); ev.target.value = ''; };
document.getElementById('exportModelBtn').onclick = function() { showCustomModal({ title: 'Export Format', type: 'prompt', defaultValue: 'gltf', placeholder: 'gltf or obj', onConfirm: function(format) { if (!format) return; var exportScene = new THREE.Scene(); exportScene.add(new THREE.AmbientLight(0xffffff, 0.5)); state.objects.forEach(function(o) { var clone = o.mesh.clone(); clone.updateMatrixWorld(true); exportScene.add(clone); }); if (format.toLowerCase() === 'gltf') { var exporter = new GLTFExporter(); exporter.parse(exportScene, function(result) { var blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }); var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'model-export.gltf'; link.click(); showToast('Exported as GLTF'); }, function(err) { showToast('Export failed: ' + err.message); }, { binary: false }); } else if (format.toLowerCase() === 'obj') { var objExporter = new OBJExporter(); var result = objExporter.parse(exportScene); var blob = new Blob([result], { type: 'text/plain' }); var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'model-export.obj'; link.click(); showToast('Exported as OBJ'); } else showToast('Use gltf or obj'); } }); };
document.getElementById('clearBtn').onclick = function() { showCustomModal({ title: 'Clear All', type: 'confirm', message: 'Clear all objects?', onConfirm: function() { clearScene(); pushHistory(); } }); };
document.getElementById('undoBtn').onclick = function() { undo(); };
document.getElementById('redoBtn').onclick = function() { redo(); };
document.getElementById('duplicateBtn').onclick = function() { duplicateSelected(); };
document.getElementById('focusBtn').onclick = function() { if (state.selectedObject) { var box = new THREE.Box3().setFromObject(state.selectedObject); var center = new THREE.Vector3(); box.getCenter(center); orbitControls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(3, 2, 3)); orbitControls.update(); } else showToast('Select an object first'); };
document.getElementById('addCubeBtn').onclick = function() { addObjectToScene(createPrimitive('cube'), 'Cube'); };
document.getElementById('addCylinderBtn').onclick = function() { addObjectToScene(createPrimitive('cylinder'), 'Cylinder'); };
document.getElementById('addSphereBtn').onclick = function() { addObjectToScene(createPrimitive('sphere'), 'Sphere'); };
document.getElementById('addWedgeBtn').onclick = function() { addObjectToScene(createPrimitive('wedge'), 'Wedge'); };
document.getElementById('addArchBtn').onclick = function() { addObjectToScene(createPrimitive('arch'), 'Arch'); };

// Cut Tool Bindings
document.getElementById('angleCutBtn').onclick = function() { 
    if (!state.selectedObject) { showToast('Select an object first'); return; }
    applyAngleCut(state.selectedObject); 
};
document.getElementById('drawCutBtn').onclick = function() { startDrawCut(); };
document.getElementById('clearCutsBtn').onclick = function() { clearAllCuts(); };

document.getElementById('measureBtn').onclick = function() { setMeasureMode(!state.measureMode); };
document.getElementById('clearMeasureBtn').onclick = function() { clearAllMeasurements(); };
document.getElementById('mirrorXBtn').onclick = function() { if (!state.selectedObject) { showToast('Select an object first'); return; } state.selectedObject.scale.x *= -1; selectionBox.setFromObject(state.selectedObject); pushHistory(); showToast('Mirrored X'); };
document.getElementById('mirrorZBtn').onclick = function() { if (!state.selectedObject) { showToast('Select an object first'); return; } state.selectedObject.scale.z *= -1; selectionBox.setFromObject(state.selectedObject); pushHistory(); showToast('Mirrored Z'); };
document.getElementById('centerPivotBtn').onclick = function() { if (!state.selectedObject) { showToast('Select an object first'); return; } var box = new THREE.Box3().setFromObject(state.selectedObject); var center = new THREE.Vector3(); box.getCenter(center); state.selectedObject.position.copy(center); selectionBox.setFromObject(state.selectedObject); pushHistory(); showToast('Pivot centered'); };
document.getElementById('resetTransformBtn').onclick = function() { if (!state.selectedObject) { showToast('Select an object first'); return; } state.selectedObject.position.set(0, 0.5, 0); state.selectedObject.rotation.set(0, 0, 0); state.selectedObject.scale.set(1, 1, 1); selectionBox.setFromObject(state.selectedObject); pushHistory(); showToast('Transform reset'); };
document.getElementById('viewTopBtn').onclick = function() { camera.position.set(0, 20, 0.01); orbitControls.target.set(0, 0, 0); orbitControls.update(); };
document.getElementById('viewFrontBtn').onclick = function() { camera.position.set(0, 3, 15); orbitControls.target.set(0, 3, 0); orbitControls.update(); };
document.getElementById('viewRightBtn').onclick = function() { camera.position.set(15, 3, 0); orbitControls.target.set(0, 3, 0); orbitControls.update(); };
document.getElementById('viewResetBtn').onclick = function() { camera.position.set(5, 4, 6); orbitControls.target.set(0, 1, 0); orbitControls.update(); };
document.getElementById('wireframeToggle').onclick = function() {
    state.wireframe = !state.wireframe;
    state.objects.forEach(function(o) {
        o.mesh.traverse(function(c) {
            if (c.isMesh && c.material) {
                c.material.wireframe = state.wireframe;
                c.userData._localWireframe = state.wireframe;
            }
        });
    });
    showToast(state.wireframe ? 'Wireframe ON' : 'Wireframe OFF');
};
document.getElementById('gridToggle').onclick = function() { state.gridVisible = !state.gridVisible; gridHelper.visible = state.gridVisible; showToast(state.gridVisible ? 'Grid ON' : 'Grid OFF'); };
document.getElementById('backToBuilderBtn').onclick = function() { window.location.href = 'Wood Plank Builder.html'; };
document.getElementById('helpBtn').onclick = function() { var h = document.getElementById('helpModal'); h.style.display = h.style.display === 'block' ? 'none' : 'block'; };
document.getElementById('helpCloseBtn').onclick = function() { document.getElementById('helpModal').style.display = 'none'; };

function resize() { var w = viewportEl.clientWidth, h = viewportEl.clientHeight; if (w === 0 || h === 0) return; renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize);

var clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    clock.getDelta();
    orbitControls.update();
    if (state.selectedObject) selectionBox.setFromObject(state.selectedObject);
    selectionBoxes.forEach(function(box, mesh) { box.setFromObject(mesh); });
    renderer.render(scene, camera);
}

try {
    resize(); updateSceneList(); updateStats(); updateProjectNameDisplay(); pushHistory();
    animate();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'grid';
    resize();
} catch (err) { console.error(err); document.getElementById('loading').innerHTML = '<p style="color:#ff6b6b;padding:20px;">' + err.message + '</p>'; }
