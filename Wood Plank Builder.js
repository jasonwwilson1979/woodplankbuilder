
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function bindWithTooltip(id, fn, tooltipFn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', fn);
    if (tooltipFn) { el.title = tooltipFn(el.value); el.addEventListener('input', () => { el.title = tooltipFn(el.value); }); }
}

document.getElementById('menubar').addEventListener('click', (e) => {
    if (e.target.closest('.menu-item') || e.target.closest('.menu-dropdown')) e.stopPropagation();
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-item')) document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
});

const DEFAULT_MATERIALS = {
    '1x4':  { w: 0.75/12, h: 3.5/12,  name: '1x4 Board', pricePerBF: 0.75, texture: 'default' },
    '1x6':  { w: 0.75/12, h: 5.5/12,  name: '1x6 Board', pricePerBF: 0.85, texture: 'default' },
    '2x4':  { w: 1.5/12,  h: 3.5/12,  name: '2x4 Stud', pricePerBF: 0.65, texture: 'default' },
    '2x6':  { w: 1.5/12,  h: 5.5/12,  name: '2x6', pricePerBF: 0.95, texture: 'default' },
    '2x8':  { w: 1.5/12,  h: 7.25/12, name: '2x8', pricePerBF: 1.15, texture: 'pine' },
    '2x10': { w: 1.5/12,  h: 9.25/12, name: '2x10', pricePerBF: 1.45, texture: 'pine' },
    '2x12': { w: 1.5/12,  h: 11.25/12,name: '2x12', pricePerBF: 1.75, texture: 'oak' },
    '4x4':  { w: 3.5/12,  h: 3.5/12,  name: '4x4 Post', pricePerBF: 1.25, texture: 'oak' },
    '6x6':  { w: 5.5/12,  h: 5.5/12,  name: '6x6 Post', pricePerBF: 2.50, texture: 'oak' },
};
const DEFAULT_SECTIONS = [
    { id: 'framing', name: 'Framing', isDefault: true, materialIds: Object.keys(DEFAULT_MATERIALS), collapsed: false },
    { id: 'custom', name: 'Custom', isDefault: true, materialIds: [], collapsed: false },
];

const state = {
    mode: 'editor', viewMode: '3d', maximizedView: null,
    selectedPlankType: '2x4', selectedLength: 8,
    selectedObject: null, planks: [], history: [], historyIndex: -1,
    gridSnap: true, rotSnap: true, ghostPlank: null, isDraggingGizmo: false,
    lookSensitivity: parseFloat(localStorage.getItem('lookSensitivity') || '4'),
    measureMode: false, measureStartPoint: null,
    measurements: [], pendingMeasureLine: null, pendingMeasureLabel: null,
    activeViewIndex: 0, ctrlPressed: false,
    materials: {}, sections: [],
    addingToSection: null, editingMaterialId: null,
    multiSelection: new Set(), groupTemplates: [],
    isDrawingShape: false, shapePoints: [], shapeLineMesh: null, customTextureData: null,
    currentProjectName: 'Untitled Project'
};
let draw2DState = { active: false, type: null, startPoint: null, endPoint: null, points: [], previewMesh: null, mode: 'create', targetMesh: null };
let selectionBoxes = new Map();
const textureCache = {};

// === PROJECT MANAGEMENT ===
function getAllProjects() {
    try { return JSON.parse(localStorage.getItem('woodBuilder_projects') || '{}'); } catch { return {}; }
}
function saveAllProjects(projects) { localStorage.setItem('woodBuilder_projects', JSON.stringify(projects)); }
function getCurrentProjectData() {
    return {
        planks: state.planks.map(p => serializeMesh(p.mesh)),
        measurements: state.measurements.map(m => ({ start: { x: m.start.x, y: m.start.y, z: m.start.z }, end: { x: m.end.x, y: m.end.y, z: m.end.z } })),
        groupTemplates: state.groupTemplates,
        materials: state.materials,
        sections: state.sections,
        savedAt: new Date().toISOString()
    };
}
function updateProjectNameDisplay() {
    document.getElementById('projectNameDisplay').textContent = `Project: ${state.currentProjectName}`;
}
function saveCurrentProject(nameOverride) {
    const name = nameOverride || state.currentProjectName;
    state.currentProjectName = name;
    const projects = getAllProjects();
    projects[name] = getCurrentProjectData();
    saveAllProjects(projects);
    updateProjectNameDisplay();
    showToast(`Saved: ${name}`);
}
function loadProjectByName(name) {
    const projects = getAllProjects();
    const data = projects[name];
    if (!data) { showToast('Project not found'); return; }
    loadProjectData(data);
    state.currentProjectName = name;
    updateProjectNameDisplay();
    showToast(`Loaded: ${name}`);
}
function loadProjectData(data) {
    // Clear current scene
    for (const p of [...state.planks]) { scene.remove(p.mesh); p.mesh.traverse(child => { if (child.geometry) child.geometry.dispose(); if (child.material) { if (child.material.map) child.material.map.dispose(); child.material.dispose(); } }); }
    state.planks = []; selectObject(null); clearAllMeasurements();
    // Restore materials and sections
    if (data.materials) state.materials = data.materials;
    if (data.sections) state.sections = data.sections;
    if (data.groupTemplates) state.groupTemplates = data.groupTemplates;
    saveMaterialsAndSections();
    buildSectionsUI(); buildGroupsUI(); buildShapesUI();
    // Restore planks
    if (data.planks) {
        for (const d of data.planks) { const mesh = deserializeMesh(d); if (!mesh) continue; scene.add(mesh); state.planks.push({ mesh, type: d.type, length: d.length }); }
    }
    updatePlankCount();
    // Restore measurements
    if (data.measurements) {
        for (const m of data.measurements) createMeasurement(new THREE.Vector3(m.start.x, m.start.y, m.start.z), new THREE.Vector3(m.end.x, m.end.y, m.end.z));
    }
    pushHistory();
    ensureGhostPlank();
}
function deleteProject(name) {
    showCustomModal({ title: 'Delete Project', type: 'confirm', message: `Delete project "${name}"? This cannot be undone.`, onConfirm: () => {
        const projects = getAllProjects();
        delete projects[name];
        saveAllProjects(projects);
        if (state.currentProjectName === name) { state.currentProjectName = 'Untitled Project'; updateProjectNameDisplay(); }
        openProjectManager();
        showToast(`Deleted: ${name}`);
    }});
}
function openProjectManager() {
    const modal = document.getElementById('projectModal');
    const content = document.getElementById('projectModalContent');
    const projects = getAllProjects();
    const names = Object.keys(projects).sort();
    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="color:#0a84ff;margin:0;">📂 Projects (${names.length})</h3>
        <button onclick="document.getElementById('projectModal').style.display='none'" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">×</button></div>`;
    if (names.length === 0) {
        html += '<p style="color:#888;font-size:12px;text-align:center;padding:20px;">No saved projects yet.<br>Use 💾 Save Project to create one.</p>';
    } else {
        names.forEach(name => {
            const proj = projects[name];
            const date = proj.savedAt ? new Date(proj.savedAt).toLocaleString() : 'Unknown';
            const plankCount = proj.planks ? proj.planks.length : 0;
            html += `<div class="project-list-item">
                <span class="proj-name">${name}</span>
                <span class="proj-date">${date} · ${plankCount} planks</span>
                <button class="load-btn" data-proj-load="${name}">Load</button>
                <button class="del-btn" data-proj-del="${name}">🗑</button>
            </div>`;
        });
    }
    content.innerHTML = html;
    modal.style.display = 'block';
    // Bind load/delete buttons
    content.querySelectorAll('[data-proj-load]').forEach(btn => {
        btn.onclick = () => { modal.style.display = 'none'; loadProjectByName(btn.dataset.projLoad); };
    });
    content.querySelectorAll('[data-proj-del]').forEach(btn => {
        btn.onclick = () => { deleteProject(btn.dataset.projDel); };
    });
}

function loadMaterialsAndSections() {
    try {
        const saved = localStorage.getItem('woodBuilder_materials');
        const savedSections = localStorage.getItem('woodBuilder_sections');
        if (saved && savedSections) {
            state.materials = JSON.parse(saved); state.sections = JSON.parse(savedSections);
            Object.keys(state.materials).forEach(k => { if(state.materials[k].pricePerBF === undefined) state.materials[k].pricePerBF = 0.75; if(state.materials[k].texture === undefined) state.materials[k].texture = 'default'; });
            if (!state.sections.find(s => s.id === 'framing')) state.sections.unshift({ id: 'framing', name: 'Framing', isDefault: true, materialIds: Object.keys(DEFAULT_MATERIALS), collapsed: false });
            if (!state.sections.find(s => s.id === 'custom')) state.sections.push({ id: 'custom', name: 'Custom', isDefault: true, materialIds: [], collapsed: false });
        } else { state.materials = { ...DEFAULT_MATERIALS }; state.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS)); }
    } catch (err) { state.materials = { ...DEFAULT_MATERIALS }; state.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS)); }
}
function saveMaterialsAndSections() { localStorage.setItem('woodBuilder_materials', JSON.stringify(state.materials)); localStorage.setItem('woodBuilder_sections', JSON.stringify(state.sections)); }
function loadGroupTemplates() { state.groupTemplates = JSON.parse(localStorage.getItem('woodBuilder_groups') || '[]'); }
function saveGroupTemplates() { localStorage.setItem('woodBuilder_groups', JSON.stringify(state.groupTemplates)); }
loadMaterialsAndSections(); loadGroupTemplates();

const viewport = document.getElementById('viewport');
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x87CEEB); scene.fog = new THREE.Fog(0x87CEEB, 80, 250);
const editorCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000); editorCamera.position.set(12, 10, 18);
const frustumSize = 20;
function makeOrthoCamera() { const cam = new THREE.OrthographicCamera(-frustumSize, frustumSize, frustumSize, -frustumSize, 0.1, 1000); cam.zoom = 1; return cam; }
const viewDefs = [
    { name: 'Top', position: new THREE.Vector3(0, 50, 0.01), lookAt: new THREE.Vector3(0, 0, 0) },
    { name: 'Front', position: new THREE.Vector3(0, 5, 50), lookAt: new THREE.Vector3(0, 5, 0) },
    { name: 'Right', position: new THREE.Vector3(50, 5, 0), lookAt: new THREE.Vector3(0, 5, 0) },
    { name: 'Left', position: new THREE.Vector3(-50, 5, 0), lookAt: new THREE.Vector3(0, 5, 0) },
];
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; viewport.appendChild(renderer.domElement);
const views = viewDefs.map(def => { const camera = makeOrthoCamera(); camera.position.copy(def.position); camera.lookAt(def.lookAt); camera.updateProjectionMatrix(); const label = document.createElement('div'); label.className = 'view-label'; label.textContent = def.name; viewport.appendChild(label); return { name: def.name, camera, controls: null, label }; });
views.forEach((view, i) => { const controls = new OrbitControls(view.camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.1; controls.enableRotate = false; controls.screenSpacePanning = true; controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }; controls.target.copy(viewDefs[i].lookAt); controls.enabled = false; view.controls = controls; });
const dividerH = document.createElement('div'); dividerH.className = 'view-divider-h'; viewport.appendChild(dividerH);
const dividerV = document.createElement('div'); dividerV.className = 'view-divider-v'; viewport.appendChild(dividerV);
let activeCamera = editorCamera;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(25, 40, 20); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -60; sun.shadow.camera.right = 60; sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60; sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 120; scene.add(sun);
scene.add(new THREE.DirectionalLight(0xffffff, 0.4).translateY(50)); scene.add(new THREE.DirectionalLight(0xffffff, 0.3).translateZ(30).translateY(10)); scene.add(new THREE.DirectionalLight(0xffffff, 0.3).translateX(30).translateY(10));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.isGround = true; scene.add(ground);
const grid = new THREE.GridHelper(100, 100, 0x000000, 0x555555); grid.position.y = 0.01; scene.add(grid);

function generateProceduralTexture(type) {
    if (textureCache[type]) return textureCache[type];
    const c = document.createElement('canvas'); c.width = 256; c.height = 256; const ctx = c.getContext('2d');
    if (type === 'oak') { ctx.fillStyle = '#5c3a21'; ctx.fillRect(0,0,256,256); for(let i=0;i<100;i++){ctx.fillStyle=`rgba(30,15,5,${Math.random()*0.4+0.1})`;ctx.fillRect(Math.random()*256,0,Math.random()*3+1,256);} }
    else if (type === 'pine') { ctx.fillStyle = '#d4a373'; ctx.fillRect(0,0,256,256); for(let i=0;i<60;i++){ctx.fillStyle=`rgba(150,100,50,${Math.random()*0.2+0.1})`;ctx.fillRect(Math.random()*256,0,Math.random()*2+0.5,256);} }
    else if (type === 'plywood') { ctx.fillStyle = '#cda87c'; ctx.fillRect(0,0,256,256); for(let i=0;i<10;i++){ctx.strokeStyle=`rgba(100,60,30,0.3)`;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,i*25+Math.random()*10);ctx.bezierCurveTo(100,i*25+Math.random()*20,150,i*25-Math.random()*20,256,i*25+Math.random()*10);ctx.stroke();} }
    else { ctx.fillStyle = '#A0703A'; ctx.fillRect(0,0,256,256); for(let i=0;i<80;i++){ctx.fillStyle=`rgba(60,40,20,${Math.random()*0.3+0.1})`;ctx.fillRect(Math.random()*256,0,Math.random()*2+0.5,256);} }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; textureCache[type] = tex; return tex;
}
function getMaterialTexture(matId, matDef) {
    if (matDef.textureData) { if (!textureCache[matId]) { const img = new Image(); const tex = new THREE.Texture(); tex.image = img; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; img.onload = () => { tex.needsUpdate = true; }; img.src = matDef.textureData; textureCache[matId] = tex; } return textureCache[matId]; }
    return generateProceduralTexture(matDef.texture || 'default');
}
function createPlankMesh(type, length) {
    const def = state.materials[type]; if (!def) return null;
    if (def.type === 'shape') return createShapeMesh(def.shapePoints, def.thickness, type);
    const geo = new THREE.BoxGeometry(def.w, length, def.h); const tex = getMaterialTexture(type, def);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.isPlank = true; mesh.userData.plankType = type; mesh.userData.plankLength = length; return mesh;
}
function createShapeMesh(points2D, thicknessFt, matId) {
    const shape = new THREE.Shape(); shape.moveTo(points2D[0][0], points2D[0][1]); for(let i=1; i<points2D.length; i++) shape.lineTo(points2D[i][0], points2D[i][1]); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thicknessFt, bevelEnabled: false }); const def = state.materials[matId]; const tex = getMaterialTexture(matId, def);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 }); const mesh = new THREE.Mesh(geo, mat); mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.isPlank = true; mesh.userData.plankType = matId; mesh.userData.plankLength = 0; return mesh;
}
function updateMeshNote(mesh, text) { mesh.userData.note = text; }
function addPlank(type, length, position, rotation) { const mesh = createPlankMesh(type, length); if(!mesh) return null; mesh.position.copy(position); if (rotation) mesh.rotation.copy(rotation); scene.add(mesh); state.planks.push({ mesh, type, length }); updatePlankCount(); pushHistory(); return mesh; }
function removePlank(mesh) { const idx = state.planks.findIndex(p => p.mesh === mesh); if (idx < 0) return; scene.remove(mesh); mesh.traverse(child => { if (child.geometry) child.geometry.dispose(); if (child.material) { if (child.material.map) child.material.map.dispose(); child.material.dispose(); } }); state.planks.splice(idx, 1); if (state.selectedObject === mesh) selectObject(null); state.multiSelection.delete(mesh); updateSelectionBoxes(); updatePlankCount(); pushHistory(); }

const orbitControls = new OrbitControls(editorCamera, renderer.domElement); orbitControls.enableDamping = true; orbitControls.dampingFactor = 0.1; orbitControls.target.set(0, 2, 0); orbitControls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
const transformControls = new TransformControls(editorCamera, renderer.domElement);
transformControls.addEventListener('dragging-changed', e => { state.isDraggingGizmo = e.value; if (state.viewMode === '3d') orbitControls.enabled = !e.value; else views.forEach((v, i) => { v.controls.enabled = !e.value && (i === state.activeViewIndex); }); });
transformControls.addEventListener('objectChange', () => { if (state.selectedObject) updatePropsPanel(); });
transformControls.addEventListener('mouseUp', () => { if (state.selectedObject) pushHistory(); });
transformControls.setTranslationSnap(state.gridSnap ? 0.5 : null); transformControls.setRotationSnap(state.rotSnap ? THREE.MathUtils.degToRad(15) : null); scene.add(transformControls);

const playerBody = new THREE.Object3D(); const fpsCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000); playerBody.add(fpsCamera); scene.add(playerBody);
let yaw = 0, pitch = 0, isLooking = false, lastMouseX = 0, lastMouseY = 0;
renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); });
renderer.domElement.addEventListener('mousedown', (e) => { if (state.mode !== 'play') return; if (e.button === 2) { isLooking = true; lastMouseX = e.clientX; lastMouseY = e.clientY; viewport.classList.add('looking'); document.getElementById('playOverlay').style.display = 'none'; } });
window.addEventListener('mousemove', (e) => { if (state.mode !== 'play' || !isLooking) return; yaw -= (e.clientX - lastMouseX) * state.lookSensitivity * 0.001; pitch = Math.max(-Math.PI/2+0.1, Math.min(Math.PI/2-0.1, pitch - (e.clientY - lastMouseY) * state.lookSensitivity * 0.001)); lastMouseX = e.clientX; lastMouseY = e.clientY; });
window.addEventListener('mouseup', (e) => { if (state.mode === 'play' && e.button === 2) { isLooking = false; viewport.classList.remove('looking'); } });
window.addEventListener('blur', () => { isLooking = false; viewport.classList.remove('looking'); });
window.addEventListener('keydown', (e) => { if (e.key === 'Control') state.ctrlPressed = true; if (e.key === 'Enter' && state.isDrawingShape) finishDrawingShape(); });
window.addEventListener('keyup', (e) => { if (e.key === 'Control') state.ctrlPressed = false; });

const VIEW_LAYOUT = [ { left: 0, bottom: 0.5, width: 0.5, height: 0.5 }, { left: 0.5, bottom: 0.5, width: 0.5, height: 0.5 }, { left: 0, bottom: 0, width: 0.5, height: 0.5 }, { left: 0.5, bottom: 0, width: 0.5, height: 0.5 } ];
function getViewportRectPx(viewIndex) { const w = viewport.clientWidth, h = viewport.clientHeight; const rect = state.maximizedView !== null ? { left: 0, bottom: 0, width: 1, height: 1 } : VIEW_LAYOUT[viewIndex]; return { left: Math.floor(rect.left * w), bottom: Math.floor(rect.bottom * h), width: Math.floor(rect.width * w), height: Math.floor(rect.height * h) }; }
function getViewIndexAtPoint(clientX, clientY) { if (state.viewMode !== '2d') return -1; const rect = viewport.getBoundingClientRect(); const x = (clientX - rect.left) / rect.width; const y = (clientY - rect.top) / rect.height; if (state.maximizedView !== null) return state.maximizedView; if (y < 0.5) return x < 0.5 ? 0 : 1; return x < 0.5 ? 2 : 3; }
function updateViewLayout() { const isMultiView = state.viewMode === '2d' && state.maximizedView === null; dividerH.style.display = isMultiView ? 'block' : 'none'; dividerV.style.display = isMultiView ? 'block' : 'none'; views.forEach((view, i) => { if (state.viewMode !== '2d') { view.label.style.display = 'none'; return; } if (state.maximizedView !== null) { if (i === state.maximizedView) { view.label.style.display = 'block'; view.label.style.left = '10px'; view.label.style.top = '8px'; view.label.classList.add('maximized'); } else { view.label.style.display = 'none'; } } else { const layout = VIEW_LAYOUT[i]; const w = viewport.clientWidth, h = viewport.clientHeight; view.label.style.display = 'block'; view.label.classList.remove('maximized'); view.label.style.left = `${layout.left * w + 10}px`; view.label.style.top = `${(1 - layout.bottom - layout.height) * h + 8}px`; } }); }
function updateCameraAspectRatios() { const w = viewport.clientWidth, h = viewport.clientHeight; if (w === 0 || h === 0) return; editorCamera.aspect = w / h; editorCamera.updateProjectionMatrix(); fpsCamera.aspect = w / h; fpsCamera.updateProjectionMatrix(); views.forEach((view, i) => { const rect = getViewportRectPx(i); const aspect = rect.width / rect.height; view.camera.left = -frustumSize * aspect; view.camera.right = frustumSize * aspect; view.camera.top = frustumSize; view.camera.bottom = -frustumSize; view.camera.updateProjectionMatrix(); }); }
function formatDistance(feet) { const totalInches = feet * 12; const ft = Math.floor(totalInches / 12); return `${ft}' ${(totalInches - ft * 12).toFixed(2)}"`; }
function createTextSprite(text, color = '#0f0') { const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0,0,512,128); ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(4,4,504,120); ctx.fillStyle = color; ctx.font = 'bold 48px Segoe UI, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64); const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })); sprite.scale.set(4, 1, 1); sprite.renderOrder = 1000; return sprite; }

function createMeasurement(start, end) { const group = new THREE.Group(); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3, depthTest: false })); line.renderOrder = 999; group.add(line); const markerGeo = new THREE.SphereGeometry(0.12, 12, 12); const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false }); const sm = new THREE.Mesh(markerGeo, markerMat); sm.position.copy(start); sm.renderOrder = 999; group.add(sm); const em = new THREE.Mesh(markerGeo, markerMat); em.position.copy(end); em.renderOrder = 999; group.add(em); const distanceFeet = start.distanceTo(end); const distanceText = formatDistance(distanceFeet); const label = createTextSprite(distanceText); const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5); midpoint.y += 0.6; label.position.copy(midpoint); group.add(label); scene.add(group); const measurement = { start: start.clone(), end: end.clone(), group, distanceFeet, distanceText }; state.measurements.push(measurement); updateMeasureCount(); renderMeasurementsPanel(); showToast(`Measured: ${distanceText}`); return measurement; }
function deleteMeasureAtIndex(i) { const m = state.measurements[i]; if (!m) return; scene.remove(m.group); m.group.traverse(child => { if (child.geometry) child.geometry.dispose(); if (child.material) { if (child.material.map) child.material.map.dispose(); child.material.dispose(); } }); state.measurements.splice(i, 1); updateMeasureCount(); renderMeasurementsPanel(); showToast('Measurement deleted'); }
function clearAllMeasurements() { for (const m of state.measurements) { scene.remove(m.group); m.group.traverse(child => { if (child.geometry) child.geometry.dispose(); if (child.material) { if (child.material.map) child.material.map.dispose(); child.material.dispose(); } }); } state.measurements = []; clearPendingMeasure(); updateMeasureCount(); renderMeasurementsPanel(); showToast('All measurements cleared'); }
function updatePendingMeasureLine(endPoint) { if (!state.measureStartPoint) return; if (state.pendingMeasureLine) { scene.remove(state.pendingMeasureLine); state.pendingMeasureLine.geometry.dispose(); state.pendingMeasureLine.material.dispose(); } if (state.pendingMeasureLabel) { scene.remove(state.pendingMeasureLabel); state.pendingMeasureLabel.material.map.dispose(); state.pendingMeasureLabel.material.dispose(); state.pendingMeasureLabel = null; } const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([state.measureStartPoint, endPoint]), new THREE.LineDashedMaterial({ color: 0xffff00, dashSize: 0.3, gapSize: 0.15, depthTest: false })); line.computeLineDistances(); line.renderOrder = 998; scene.add(line); state.pendingMeasureLine = line; const label = createTextSprite(formatDistance(state.measureStartPoint.distanceTo(endPoint)), '#ff0'); const midpoint = new THREE.Vector3().addVectors(state.measureStartPoint, endPoint).multiplyScalar(0.5); midpoint.y += 0.6; label.position.copy(midpoint); scene.add(label); state.pendingMeasureLabel = label; }
function clearPendingMeasure() { if (state.pendingMeasureLine) { scene.remove(state.pendingMeasureLine); state.pendingMeasureLine.geometry.dispose(); state.pendingMeasureLine.material.dispose(); state.pendingMeasureLine = null; } if (state.pendingMeasureLabel) { scene.remove(state.pendingMeasureLabel); state.pendingMeasureLabel.material.map.dispose(); state.pendingMeasureLabel.material.dispose(); state.pendingMeasureLabel = null; } state.measureStartPoint = null; }
function setMeasureMode(active) { state.measureMode = active; document.getElementById('measureOverlay').style.display = active ? 'block' : 'none'; document.getElementById('hintText').textContent = active ? (state.measureStartPoint ? 'Click second point to complete measurement' : 'Click first point to start measuring') : 'Ctrl+Click ground to place • Left click to select'; if (!active) clearPendingMeasure(); }
window.focusMeasure = (i) => { const m = state.measurements[i]; if (!m) return; const mid = new THREE.Vector3().addVectors(m.start, m.end).multiplyScalar(0.5); if (state.viewMode === '3d') { orbitControls.target.copy(mid); editorCamera.position.copy(mid).add(new THREE.Vector3(5,5,5)); orbitControls.update(); } else { views.forEach(v => { v.controls.target.copy(mid); v.controls.update(); }); } showToast(`Focused on measurement #${i+1}`); };
window.editMeasure = (i) => { const m = state.measurements[i]; if (!m) return; const start = m.start.clone(); deleteMeasureAtIndex(i); setMeasureMode(true); state.measureStartPoint = start; document.getElementById('hintText').textContent = 'Click new second point to complete measurement'; };
window.deleteMeasure = (i) => { deleteMeasureAtIndex(i); };
function renderMeasurementsPanel() { const panel = document.getElementById('measuresContent'); if (state.measurements.length === 0) { panel.innerHTML = `<p style="color:#666;font-size:12px;">No measurements yet.<br><br>Press <kbd style="background:#333;padding:1px 4px;border-radius:2px;border:1px solid #555;">M</kbd> or click 📏 Measure to start.</p>`; return; } let html = ''; state.measurements.forEach((m, i) => { html += `<div class="measure-item"><div class="measure-item-header"><span class="measure-item-num">#${i+1}</span><span class="measure-item-dist">${m.distanceText}</span></div><div class="measure-item-details">ΔX: ${((m.end.x-m.start.x)*12).toFixed(1)}" · ΔY: ${((m.end.y-m.start.y)*12).toFixed(1)}" · ΔZ: ${((m.end.z-m.start.z)*12).toFixed(1)}"<br>Total: ${m.distanceFeet.toFixed(2)} ft</div><div class="measure-btn-row"><button class="measure-btn" onclick="window.focusMeasure(${i})">🎯 Focus</button><button class="measure-btn" onclick="window.editMeasure(${i})">✏️ Edit</button><button class="measure-btn delete" onclick="window.deleteMeasure(${i})">🗑 Delete</button></div></div>`; }); panel.innerHTML = html; }

function startDrawingShape() { state.isDrawingShape = true; state.shapePoints = []; document.getElementById('shapeOverlay').style.display = 'block'; viewport.classList.add('drawing'); if (state.ghostPlank) state.ghostPlank.visible = false; }
function cancelDrawingShape() { state.isDrawingShape = false; state.shapePoints = []; if (state.shapeLineMesh) { scene.remove(state.shapeLineMesh); state.shapeLineMesh.geometry.dispose(); state.shapeLineMesh.material.dispose(); state.shapeLineMesh = null; } document.getElementById('shapeOverlay').style.display = 'none'; viewport.classList.remove('drawing'); }
function updateShapeLine() { if (state.shapeLineMesh) { scene.remove(state.shapeLineMesh); state.shapeLineMesh.geometry.dispose(); state.shapeLineMesh.material.dispose(); } if (state.shapePoints.length < 2) return; const points = state.shapePoints.map(p => new THREE.Vector3(p[0], 0.05, p[1])); points.push(points[0].clone()); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 3, depthTest: false })); line.renderOrder = 999; scene.add(line); state.shapeLineMesh = line; }

function showCustomModal(options) {
    const modal = document.createElement('div'); modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:3000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div'); box.style.cssText = 'background:#2a2a2a;border:1px solid #0a84ff;padding:20px;border-radius:8px;min-width:300px;max-width:90%;color:#ddd;font-family:sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.5);';
    const title = document.createElement('h3'); title.style.cssText = 'margin:0 0 15px 0;font-size:14px;color:#0a84ff;'; title.textContent = options.title; box.appendChild(title);
    if (options.message) { const msg = document.createElement('p'); msg.style.cssText = 'margin:0 0 15px 0;font-size:13px;line-height:1.5;color:#ccc;'; msg.textContent = options.message; box.appendChild(msg); }
    let input = null;
    if (options.type === 'prompt') { input = document.createElement('input'); input.type = 'text'; input.value = options.defaultValue || ''; input.placeholder = options.placeholder || ''; input.style.cssText = 'width:100%;padding:8px;background:#1a1a1a;border:1px solid #444;color:#ddd;border-radius:4px;margin-bottom:15px;box-sizing:border-box;'; box.appendChild(input); }
    const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancel'; cancelBtn.style.cssText = 'padding:6px 16px;background:#444;border:none;color:#ddd;border-radius:4px;cursor:pointer;'; cancelBtn.onclick = () => { if (document.body.contains(modal)) document.body.removeChild(modal); if (options.onCancel) options.onCancel(); };
    const confirmBtn = document.createElement('button'); confirmBtn.textContent = options.type === 'confirm' ? 'Delete' : 'OK'; confirmBtn.style.cssText = `padding:6px 16px;background:${options.type==='confirm'?'#8b2020':'#0a84ff'};border:none;color:white;border-radius:4px;cursor:pointer;`; confirmBtn.onclick = () => { if (document.body.contains(modal)) document.body.removeChild(modal); if (options.onConfirm) options.onConfirm(input ? input.value : true); };
    if (options.type !== 'alert') btnRow.appendChild(cancelBtn); btnRow.appendChild(confirmBtn); box.appendChild(btnRow); modal.appendChild(box); document.body.appendChild(modal);
    if (input) { setTimeout(() => { input.focus(); input.select(); }, 50); input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') confirmBtn.click(); if (ev.key === 'Escape') cancelBtn.click(); }); }
    else { setTimeout(() => confirmBtn.focus(), 50); modal.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cancelBtn.click(); }); }
    modal.addEventListener('click', (ev) => { if (ev.target === modal) cancelBtn.click(); });
}

function finishDrawingShape() {
    if (state.shapePoints.length < 3) { showToast("Need at least 3 points for a shape"); return; }
    showCustomModal({ title: 'Shape Thickness (inches)', type: 'prompt', defaultValue: '1.5', onConfirm: (thicknessInStr) => {
        const thicknessIn = parseFloat(thicknessInStr); if (!thicknessIn || thicknessIn <= 0) { cancelDrawingShape(); return; }
        showCustomModal({ title: 'Save Shape Material', type: 'prompt', defaultValue: 'Custom Shape', onConfirm: (name) => {
            if (!name) { cancelDrawingShape(); return; }
            const id = 'shape_' + Date.now(); state.materials[id] = { type: 'shape', name: name, shapePoints: [...state.shapePoints], thickness: thicknessIn/12, texture: 'default', pricePerBF: 1.00 };
            let shapeSection = state.sections.find(s => s.id === 'shapes'); if (!shapeSection) { shapeSection = { id: 'shapes', name: 'Custom Shapes', isDefault: true, materialIds: [], collapsed: false }; state.sections.push(shapeSection); }
            shapeSection.materialIds.push(id); saveMaterialsAndSections(); buildSectionsUI(); buildShapesUI();
            const mesh = addPlank(id, 0, new THREE.Vector3(0,0,0)); if(mesh) selectObject(mesh); cancelDrawingShape(); showToast(`Created shape "${name}"`);
        }});
    }});
}

function start2DDraw(type, mode = 'create') {
    if (mode === 'cut' && !state.selectedObject) { showToast("Please select a plank to cut first!"); return; }
    draw2DState = { active: true, type, mode, points: [], startPoint: null, endPoint: null, previewMesh: null, targetMesh: state.selectedObject };
    setViewMode('2d'); setMaximizedView(0); showToast(`${mode === 'cut' ? 'CUTTING: Draw '+type+' on selected plank.' : 'Drawing '+type+'. Click in Top View.'} (ESC to cancel)`);
}
function cancel2DDraw() { if (draw2DState.previewMesh) { scene.remove(draw2DState.previewMesh); draw2DState.previewMesh.geometry.dispose(); draw2DState.previewMesh.material.dispose(); draw2DState.previewMesh = null; } draw2DState.active = false; draw2DState.targetMesh = null; showToast("Draw cancelled"); }
function update2DPreview(hitPoint) {
    if (draw2DState.previewMesh) { scene.remove(draw2DState.previewMesh); draw2DState.previewMesh.geometry.dispose(); draw2DState.previewMesh.material.dispose(); draw2DState.previewMesh = null; }
    if (!hitPoint) return;
    let shape = new THREE.Shape();
    if (draw2DState.type === 'circle') { if (!draw2DState.startPoint) return; shape.absarc(0, 0, draw2DState.startPoint.distanceTo(hitPoint), 0, Math.PI*2, false); }
    else if (draw2DState.type === 'rect') { if (!draw2DState.startPoint) return; const x1=draw2DState.startPoint.x, z1=draw2DState.startPoint.z, x2=hitPoint.x, z2=hitPoint.z; shape.moveTo(x1,z1); shape.lineTo(x2,z1); shape.lineTo(x2,z2); shape.lineTo(x1,z2); shape.closePath(); }
    else if (draw2DState.type === 'poly') { if (draw2DState.points.length === 0) return; shape.moveTo(draw2DState.points[0].x, draw2DState.points[0].z); for(let i=1;i<draw2DState.points.length;i++) shape.lineTo(draw2DState.points[i].x, draw2DState.points[i].z); shape.lineTo(hitPoint.x, hitPoint.z); }
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: draw2DState.mode==='cut'?0xff0000:0x00ffff, transparent:true, opacity:0.4, side:THREE.DoubleSide, depthTest:false }));
    mesh.rotation.x = -Math.PI/2; mesh.position.y = 0.05;
    if (draw2DState.type === 'circle' && draw2DState.startPoint) { mesh.position.x = draw2DState.startPoint.x; mesh.position.z = draw2DState.startPoint.z; }
    scene.add(mesh); draw2DState.previewMesh = mesh;
}
function finish2DDraw() {
    if (draw2DState.previewMesh) { scene.remove(draw2DState.previewMesh); draw2DState.previewMesh.geometry.dispose(); draw2DState.previewMesh.material.dispose(); draw2DState.previewMesh = null; }
    let points2D = []; let centerX = 0, centerZ = 0;
    if (draw2DState.type === 'circle') { const r = draw2DState.startPoint.distanceTo(draw2DState.endPoint); for(let i=0;i<=32;i++){const a=(i/32)*Math.PI*2;points2D.push([Math.cos(a)*r,Math.sin(a)*r]);} centerX=draw2DState.startPoint.x; centerZ=draw2DState.startPoint.z; }
    else if (draw2DState.type === 'rect') { const x1=draw2DState.startPoint.x, z1=draw2DState.startPoint.z, x2=draw2DState.endPoint.x, z2=draw2DState.endPoint.z; points2D=[[x1,z1],[x2,z1],[x2,z2],[x1,z2]]; centerX=(x1+x2)/2; centerZ=(z1+z2)/2; points2D=points2D.map(p=>[p[0]-centerX,p[1]-centerZ]); }
    else if (draw2DState.type === 'poly') { if(draw2DState.points.length<3){showToast("Need 3 points");return;} points2D=draw2DState.points.map(p=>[p.x,p.z]); let sx=0,sz=0; draw2DState.points.forEach(p=>{sx+=p.x;sz+=p.z;}); centerX=sx/draw2DState.points.length; centerZ=sz/draw2DState.points.length; points2D=points2D.map(p=>[p[0]-centerX,p[1]-centerZ]); }
    const defaultThk = draw2DState.mode==='cut'&&draw2DState.targetMesh ? (state.materials[draw2DState.targetMesh.userData.plankType].h*12*draw2DState.targetMesh.scale.z).toFixed(2) : '1.5';
    showCustomModal({ title: draw2DState.mode==='cut'?'Cut Thickness (inches)':'Extrude Thickness (inches)', type:'prompt', defaultValue:defaultThk, onConfirm:(thkStr)=>{
        const thkIn=parseFloat(thkStr); if(!thkIn||thkIn<=0)return; const id=(draw2DState.mode==='cut'?'cut_':'draw_')+Date.now();
        state.materials[id]={type:'shape',name:`${draw2DState.mode==='cut'?'Cut Piece':'Drawn Shape'} ${id.slice(-4)}`,shapePoints:points2D,thickness:thkIn/12,texture:'default',pricePerBF:1.00};
        let shapeSection=state.sections.find(s=>s.id==='shapes'); if(!shapeSection){shapeSection={id:'shapes',name:'Custom Shapes',isDefault:true,materialIds:[],collapsed:false};state.sections.push(shapeSection);}
        shapeSection.materialIds.push(id); saveMaterialsAndSections(); buildShapesUI();
        let mesh=createPlankMesh(id,0); mesh.position.set(centerX,0,centerZ); if(mesh){scene.add(mesh);state.planks.push({mesh,type:id,length:0});selectObject(mesh);updatePlankCount();pushHistory();}
        draw2DState.active=false; draw2DState.targetMesh=null; showToast(draw2DState.mode==='cut'?"Piece cut successfully!":"Shape created!");
    }});
}

function ensureGhostPlank() {
    if (state.ghostPlank) { scene.remove(state.ghostPlank); state.ghostPlank.traverse(c => { if(c.geometry) c.geometry.dispose(); if(c.material) { if(c.material.map) c.material.map.dispose(); c.material.dispose(); } }); state.ghostPlank = null; }
    if (state.selectedPlankType.startsWith('grp_')) { const template = state.groupTemplates.find(g => g.id === state.selectedPlankType); if (!template) return; const group = new THREE.Group(); template.children.forEach(cData => { const child = deserializeMesh(cData); if(child) { child.material = child.material.clone(); child.material.transparent = true; child.material.opacity = 0.3; child.material.color.set(0x88ff88); group.add(child); } }); group.userData.isGhost = true; group.visible = false; scene.add(group); state.ghostPlank = group; return group; }
    if (state.ghostPlank && state.ghostPlank.userData.plankType === state.selectedPlankType && state.ghostPlank.userData.plankLength === state.selectedLength) return state.ghostPlank;
    const mesh = createPlankMesh(state.selectedPlankType, state.selectedLength); if(!mesh) return; mesh.material = mesh.material.clone(); mesh.material.transparent = true; mesh.material.opacity = 0.5; mesh.material.color.set(0x88ff88); mesh.userData.isGhost = true; mesh.visible = false; scene.add(mesh); state.ghostPlank = mesh; return mesh;
}

const raycaster = new THREE.Raycaster(); const mouseNDC = new THREE.Vector2();
function raycastEditor(event, objects) {
    if (state.viewMode === '3d') { const rect = viewport.getBoundingClientRect(); mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(mouseNDC, editorCamera); }
    else { const viewIndex = getViewIndexAtPoint(event.clientX, event.clientY); if (viewIndex < 0) return []; const rect = viewport.getBoundingClientRect(); const vRect = getViewportRectPx(viewIndex); const localX = event.clientX - rect.left - vRect.left; const flippedY = rect.height - (event.clientY - rect.top) - vRect.bottom; mouseNDC.set((localX / vRect.width) * 2 - 1, (flippedY / vRect.height) * 2 - 1); raycaster.setFromCamera(mouseNDC, views[viewIndex].camera); }
    return raycaster.intersectObjects(objects, true);
}

const selectionBox = new THREE.BoxHelper(); selectionBox.material.color.set(0x0a84ff); selectionBox.material.depthTest = false; selectionBox.renderOrder = 999;
function selectObject(mesh) {
    if (state.selectedObject) scene.remove(selectionBox);
    state.selectedObject = mesh;
    if (!mesh || mesh.userData.plankType === 'group') { buildSectionsUI(); buildGroupsUI(); buildShapesUI(); }
    if (mesh && state.mode === 'editor') { transformControls.attach(mesh); selectionBox.setFromObject(mesh); scene.add(selectionBox); } else { transformControls.detach(); }
    updatePropsPanel();
}
function updateSelectionBoxes() { selectionBoxes.forEach((box) => { scene.remove(box); box.geometry.dispose(); box.material.dispose(); }); selectionBoxes.clear(); state.multiSelection.forEach(mesh => { const box = new THREE.BoxHelper(mesh, 0x0a84ff); box.material.depthTest = false; box.renderOrder = 999; scene.add(box); selectionBoxes.set(mesh, box); }); if (state.multiSelection.size === 1) selectObject(Array.from(state.multiSelection)[0]); else { transformControls.detach(); state.selectedObject = null; updatePropsPanel(); } }

function pushHistory() { const snapshot = state.planks.map(p => serializeMesh(p.mesh)); state.history = state.history.slice(0, state.historyIndex + 1); state.history.push(snapshot); state.historyIndex = state.history.length - 1; if (state.history.length > 50) { state.history.shift(); state.historyIndex--; } }
function serializeMesh(mesh) { if (mesh.userData.plankType === 'group') return { type: 'group', length: 0, px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z, rx: mesh.rotation.x, ry: mesh.rotation.y, rz: mesh.rotation.z, sx: mesh.scale.x, sy: mesh.scale.y, sz: mesh.scale.z, note: mesh.userData.note || null, price: mesh.userData.pricePerBF, children: mesh.children.filter(c => c.isMesh || c.userData.plankType === 'group').map(c => serializeMesh(c)) }; return { type: mesh.userData.plankType, length: mesh.userData.plankLength, px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z, rx: mesh.rotation.x, ry: mesh.rotation.y, rz: mesh.rotation.z, sx: mesh.scale.x, sy: mesh.scale.y, sz: mesh.scale.z, note: mesh.userData.note || null, price: mesh.userData.pricePerBF }; }
function deserializeMesh(data) { if (data.type === 'group') { const group = new THREE.Group(); group.userData.isPlank = true; group.userData.plankType = 'group'; group.userData.plankLength = 0; group.position.set(data.px, data.py, data.pz); group.rotation.set(data.rx, data.ry, data.rz); group.scale.set(data.sx, data.sy, data.sz); if(data.note) group.userData.note = data.note; if(data.price !== undefined) group.userData.pricePerBF = data.price; data.children.forEach(cData => { const child = deserializeMesh(cData); if(child) group.add(child); }); if(group.userData.note) updateMeshNote(group, group.userData.note); return group; } if (!state.materials[data.type]) return null; const mesh = createPlankMesh(data.type, data.length); if(!mesh) return null; mesh.position.set(data.px, data.py, data.pz); mesh.rotation.set(data.rx, data.ry, data.rz); if (data.sx) mesh.scale.set(data.sx, data.sy, data.sz); if(data.note) mesh.userData.note = data.note; if(data.price !== undefined) mesh.userData.pricePerBF = data.price; if(mesh.userData.note) updateMeshNote(mesh, mesh.userData.note); return mesh; }
function restoreSnapshot(snapshot) { for (const p of [...state.planks]) { scene.remove(p.mesh); p.mesh.traverse(child => { if (child.geometry) child.geometry.dispose(); if (child.material) { if (child.material.map) child.material.map.dispose(); child.material.dispose(); } }); } state.planks = []; selectObject(null); for (const s of snapshot) { const mesh = deserializeMesh(s); if (!mesh) continue; scene.add(mesh); state.planks.push({ mesh, type: s.type, length: s.length }); } updatePlankCount(); }
function undo() { if (state.historyIndex > 0) { state.historyIndex--; restoreSnapshot(state.history[state.historyIndex]); } }
function redo() { if (state.historyIndex < state.history.length - 1) { state.historyIndex++; restoreSnapshot(state.history[state.historyIndex]); } }
function generateMaterialId() { return 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5); }
function generateSectionId() { return 'section_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5); }

function showNewSectionForm() {
    const container = document.getElementById('sectionsContainer'); if (document.getElementById('newSectionForm')) return;
    const form = document.createElement('div'); form.id = 'newSectionForm'; form.className = 'new-material-form';
    form.innerHTML = `<div style="font-size:11px;font-weight:bold;color:#0a84ff;margin-bottom:6px;">+ New Section</div><input type="text" id="newSectionName" placeholder="Section name" maxlength="30"><div class="form-btns"><button onclick="window.cancelNewSection()">Cancel</button><button class="primary" onclick="window.confirmNewSection()">Create</button></div>`;
    container.prepend(form); setTimeout(() => { const input = document.getElementById('newSectionName'); if (input) { input.focus(); input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') window.confirmNewSection(); if (ev.key === 'Escape') window.cancelNewSection(); }); } }, 0);
}
window.cancelNewSection = () => { const form = document.getElementById('newSectionForm'); if (form) form.remove(); };
window.confirmNewSection = () => { const input = document.getElementById('newSectionName'); if (!input) return; const name = input.value.trim(); if (!name) { showToast("Please enter a name"); return; } if (!Array.isArray(state.sections)) state.sections = []; state.sections.push({ id: generateSectionId(), name: name, isDefault: false, materialIds: [], collapsed: false }); saveMaterialsAndSections(); buildSectionsUI(); showToast(`Created section "${name}"`); };

function buildSectionsUI() {
    const container = document.getElementById('sectionsContainer');
    if (!container) return;
    const currentSectionIds = Array.from(container.children).map(el => el.dataset.sectionId);
    const newStateIds = state.sections.filter(s => s.id !== 'shapes').map(s => s.id);
    const needsFullRebuild = JSON.stringify(currentSectionIds) !== JSON.stringify(newStateIds);
    if (!needsFullRebuild && container.children.length > 0) {
        state.sections.forEach(section => {
            if (section.id === 'shapes') return;
            const sectionEl = container.querySelector(`[data-section-id="${section.id}"]`);
            if (!sectionEl) return;
            const contentEl = sectionEl.querySelector('.section-content');
            const toggleEl = sectionEl.querySelector('.section-toggle');
            if (section.collapsed) { if (contentEl) contentEl.style.display = 'none'; if (toggleEl) toggleEl.textContent = '▶'; }
            else {
                if (contentEl) contentEl.style.display = 'block'; if (toggleEl) toggleEl.textContent = '▼';
                const existingForm = contentEl?.querySelector('.new-material-form');
                const shouldShowForm = state.addingToSection === section.id;
                if (shouldShowForm && !existingForm) rebuildSingleSection(section);
                else if (!shouldShowForm && existingForm) existingForm.remove();
            }
        });
        if (state.addingToSection) setTimeout(() => { const inp = document.getElementById('newMatName'); if (inp && document.activeElement !== inp) inp.focus(); }, 10);
        return;
    }
    container.innerHTML = '';
    state.sections.forEach(section => { if (section.id === 'shapes') return; rebuildSingleSection(section); });
}

function rebuildSingleSection(section) {
    const container = document.getElementById('sectionsContainer');
    const existing = container.querySelector(`[data-section-id="${section.id}"]`);
    if (existing) existing.remove();
    const sectionEl = document.createElement('div'); sectionEl.className = 'section-wrapper'; sectionEl.dataset.sectionId = section.id;
    const header = document.createElement('div'); header.className = 'section-header';
    const toggle = document.createElement('span'); toggle.className = 'section-toggle'; toggle.textContent = section.collapsed ? '▶' : '▼';
    toggle.onclick = (ev) => { ev.stopPropagation(); ev.preventDefault(); section.collapsed = !section.collapsed; if (section.collapsed) { state.addingToSection = null; state.editingMaterialId = null; } saveMaterialsAndSections(); buildSectionsUI(); };
    const name = document.createElement('span'); name.className = 'section-name' + (section.isDefault ? ' default' : ''); name.textContent = section.name;
    name.onclick = () => { section.collapsed = !section.collapsed; if (section.collapsed) { state.addingToSection = null; state.editingMaterialId = null; } saveMaterialsAndSections(); buildSectionsUI(); };
    name.oncontextmenu = (ev) => { ev.preventDefault(); showSectionContextMenu(ev, section); };
    const addBtn = document.createElement('button'); addBtn.className = 'section-btn'; addBtn.textContent = '+'; addBtn.title = 'Add material to this section';
    addBtn.onclick = (ev) => { ev.stopPropagation(); ev.preventDefault(); section.collapsed = false; if (state.addingToSection === section.id && state.editingMaterialId === null) { state.addingToSection = null; } else { state.addingToSection = section.id; state.editingMaterialId = null; } saveMaterialsAndSections(); buildSectionsUI(); };
    const menuBtn = document.createElement('button'); menuBtn.className = 'section-btn'; menuBtn.textContent = '⋮'; menuBtn.title = 'Section options'; menuBtn.onclick = (ev) => { ev.stopPropagation(); showSectionContextMenu(ev, section); };
    header.appendChild(toggle); header.appendChild(name); header.appendChild(addBtn); header.appendChild(menuBtn);
    sectionEl.appendChild(header);
    if (!section.collapsed) {
        const content = document.createElement('div'); content.className = 'section-content';
        if (state.addingToSection === section.id) {
            const form = document.createElement('div'); form.className = 'new-material-form'; const isEditing = state.editingMaterialId !== null; const editMat = isEditing ? state.materials[state.editingMaterialId] : null;
            form.innerHTML = `<div style="font-size:11px;font-weight:bold;color:#0a84ff;margin-bottom:6px;">${isEditing?'✏️ Edit Material':'+ New Material'}</div><input type="text" id="newMatName" placeholder="Material name" maxlength="30" value="${isEditing?editMat.name:''}"><div class="form-row"><input type="number" id="newMatW" placeholder="Thickness (in)" step="0.125" min="0.1" value="${isEditing?(editMat.w*12).toFixed(3):''}"><input type="number" id="newMatH" placeholder="Width (in)" step="0.125" min="0.1" value="${isEditing?(editMat.h*12).toFixed(3):''}"></div><div class="form-row"><input type="number" id="newMatL" placeholder="Length (ft)" step="1" min="1" value="${isEditing?(editMat.defaultLength||8):8}"><input type="number" id="newMatPrice" placeholder="Price/BF ($)" step="0.01" min="0" value="${isEditing?(editMat.pricePerBF||0.75):0.75}"></div><select id="newMatTexture"><option value="default" ${(isEditing?editMat.texture:'default')==='default'?'selected':''}>Default Wood</option><option value="oak" ${(isEditing?editMat.texture:'')==='oak'?'selected':''}>Oak (Dark)</option><option value="pine" ${(isEditing?editMat.texture:'')==='pine'?'selected':''}>Pine (Light)</option><option value="plywood" ${(isEditing?editMat.texture:'')==='plywood'?'selected':''}>Plywood</option></select><label class="file-upload-label" for="newMatFile">📁 Upload Custom Texture</label><input type="file" id="newMatFile" accept="image/*" style="display:none;"><div id="filePreview" style="font-size:10px;color:#888;margin-bottom:4px;text-align:center;">${isEditing&&editMat.textureData?'Current: Custom Image':''}</div><div class="form-btns"><button onclick="window.cancelAddMaterial()">Cancel</button><button class="primary" onclick="window.saveMaterial('${section.id}')">${isEditing?'Update':'Create'}</button></div>`;
            content.appendChild(form);
            setTimeout(() => { const fileInput = document.getElementById('newMatFile'); if (fileInput) { fileInput.onchange = (fev) => { const file = fev.target.files[0]; if (file) { const reader = new FileReader(); reader.onload = (evt) => { state.customTextureData = evt.target.result; const preview = document.getElementById('filePreview'); if (preview) preview.textContent = file.name; const texSel = document.getElementById('newMatTexture'); if (texSel) texSel.value = 'custom'; }; reader.readAsDataURL(file); } }; } const nameInp = document.getElementById('newMatName'); if (nameInp && document.activeElement !== nameInp) nameInp.focus(); }, 10);
        }
        section.materialIds.forEach(matId => {
            const def = state.materials[matId]; if (!def) return;
            const item = document.createElement('div'); item.className = 'plank-item' + (matId === state.selectedPlankType ? ' selected' : '');
            item.innerHTML = `<div class="plank-icon"></div><div class="plank-info"><div class="plank-name">${def.name}</div><div class="plank-size">${(def.w*12).toFixed(2)}" T × ${(def.h*12).toFixed(2)}" W · $${(def.pricePerBF||0.75).toFixed(2)}/bf</div></div><div class="plank-actions"><button class="plank-action-btn" title="Edit">✏️</button><button class="plank-action-btn delete" title="Delete">×</button></div>`;
            item.onclick = () => {
                if (state.selectedPlankType === matId && !state.selectedObject) { state.selectedPlankType = null; }
                else { state.selectedPlankType = matId; if (def.defaultLength) { state.selectedLength = def.defaultLength; document.getElementById('lengthSelect').value = def.defaultLength; } }
                const ctr = document.getElementById('sectionsContainer'); ctr.innerHTML = '';
                state.sections.forEach(sec => { if (sec.id === 'shapes') return; rebuildSingleSection(sec); });
                buildGroupsUI(); buildShapesUI(); ensureGhostPlank();
                if (!state.selectedObject) updatePropsPanel();
            };
            item.querySelector('.plank-action-btn:not(.delete)').onclick = (ev) => { ev.stopPropagation(); ev.preventDefault(); state.editingMaterialId = matId; state.addingToSection = section.id; section.collapsed = false; saveMaterialsAndSections(); buildSectionsUI(); };
            item.querySelector('.plank-action-btn.delete').onclick = (ev) => { ev.stopPropagation(); ev.preventDefault(); deleteMaterial(matId); };
            content.appendChild(item);
        });
        sectionEl.appendChild(content);
    }
    container.appendChild(sectionEl);
}

function editShapeProperties(matId) { const def = state.materials[matId]; if (!def) return; showCustomModal({ title: 'Edit Shape Name', type: 'prompt', defaultValue: def.name, onConfirm: (newName) => { if (newName === null || !newName.trim()) return; def.name = newName.trim(); showCustomModal({ title: 'Edit Thickness (inches)', type: 'prompt', defaultValue: (def.thickness*12).toFixed(2), onConfirm: (newThk) => { if (newThk === null) return; const thkFt = parseFloat(newThk)/12; if (!thkFt || thkFt <= 0) { showToast("Invalid thickness"); return; } def.thickness = thkFt; saveMaterialsAndSections(); buildShapesUI(); ensureGhostPlank(); updatePropsPanel(); showToast(`Updated shape "${def.name}"`); }}); }}); }
function redrawShape(matId) { const def = state.materials[matId]; if (!def) return; showCustomModal({ title: 'Redraw Shape', type: 'confirm', message: `Redraw "${def.name}"? This will delete the current shape and start the drawing tool.`, onConfirm: () => { const shapeSection = state.sections.find(s => s.id === 'shapes'); if (shapeSection) shapeSection.materialIds = shapeSection.materialIds.filter(id => id !== matId); delete state.materials[matId]; if (state.selectedPlankType === matId) state.selectedPlankType = '2x4'; saveMaterialsAndSections(); buildShapesUI(); ensureGhostPlank(); startDrawingShape(); }}); }

function buildShapesUI() {
    const container = document.getElementById('shapesContainer');
    const shapeSection = state.sections.find(s => s.id === 'shapes');
    if (!shapeSection || shapeSection.materialIds.length === 0) { container.innerHTML = `<p style="color:#666;font-size:11px;font-style:italic;">No custom shapes. Use ✂️ 2D Draw or 🔪 Cut Shape.</p>`; return; }
    container.innerHTML = '';
    shapeSection.materialIds.forEach(matId => {
        const def = state.materials[matId]; if (!def || def.type !== 'shape') return;
        const item = document.createElement('div'); item.className = 'plank-item' + (state.selectedPlankType === matId ? ' selected' : '');
        item.innerHTML = `<div class="plank-icon shape"></div><div class="plank-info"><div class="plank-name">${def.name}</div><div class="plank-size">${def.shapePoints.length} pts · ${(def.thickness*12).toFixed(1)}" thk</div></div><div class="plank-actions"><button class="plank-action-btn" title="Edit Properties">✏️</button><button class="plank-action-btn" title="Redraw Shape">🔄</button><button class="plank-action-btn delete" title="Delete Shape">×</button></div>`;
        item.onclick = () => { state.selectedPlankType = matId; state.selectedLength = 0; buildSectionsUI(); buildGroupsUI(); buildShapesUI(); ensureGhostPlank(); if (!state.selectedObject) updatePropsPanel(); };
        item.querySelector('.plank-action-btn[title="Edit Properties"]').onclick = (ev) => { ev.stopPropagation(); editShapeProperties(matId); };
        item.querySelector('.plank-action-btn[title="Redraw Shape"]').onclick = (ev) => { ev.stopPropagation(); redrawShape(matId); };
        item.querySelector('.delete').onclick = (ev) => { ev.stopPropagation(); showCustomModal({ title: 'Delete Shape', type: 'confirm', message: `Delete shape "${def.name}"?`, onConfirm: () => { shapeSection.materialIds = shapeSection.materialIds.filter(id => id !== matId); delete state.materials[matId]; saveMaterialsAndSections(); buildShapesUI(); if(state.selectedPlankType === matId) { state.selectedPlankType = '2x4'; ensureGhostPlank(); } }}); };
        container.appendChild(item);
    });
}

function buildGroupsUI() {
    const container = document.getElementById('groupsContainer');
    if (state.groupTemplates.length === 0) { container.innerHTML = `<p style="color:#666;font-size:11px;font-style:italic;">No groups saved. Select planks and click Group.</p>`; return; }
    container.innerHTML = '';
    state.groupTemplates.forEach(t => {
        const item = document.createElement('div'); item.className = 'plank-item' + (state.selectedPlankType === t.id ? ' selected' : '');
        item.innerHTML = `<div class="plank-icon group"></div><div class="plank-info"><div class="plank-name">${t.name}</div><div class="plank-size">${t.children.length} components</div></div><div class="plank-actions"><button class="plank-action-btn" title="Rename Group">✏️</button><button class="plank-action-btn" title="Copy Group">📋</button><button class="plank-action-btn delete" title="Delete Template">×</button></div>`;
        item.onclick = () => { state.selectedPlankType = t.id; state.selectedLength = 0; buildSectionsUI(); buildGroupsUI(); buildShapesUI(); ensureGhostPlank(); if (!state.selectedObject) updatePropsPanel(); };
        item.querySelector('.plank-action-btn[title="Rename Group"]').onclick = (ev) => { ev.stopPropagation(); editGroupTemplate(t.id); };
        item.querySelector('.plank-action-btn[title="Copy Group"]').onclick = (ev) => { ev.stopPropagation(); copyGroupTemplate(t.id); };
        item.querySelector('.delete').onclick = (ev) => { ev.stopPropagation(); deleteGroupTemplate(t.id); };
        container.appendChild(item);
    });
}

function editGroupTemplate(id) { const t = state.groupTemplates.find(g => g.id === id); if (!t) return; showCustomModal({ title: 'Rename Group Template', type: 'prompt', defaultValue: t.name, onConfirm: (newName) => { if (newName && newName.trim()) { t.name = newName.trim(); saveGroupTemplates(); buildGroupsUI(); showToast(`Renamed to "${t.name}"`); } }}); }
function copyGroupTemplate(id) { const t = state.groupTemplates.find(g => g.id === id); if (!t) return; const newTemplate = JSON.parse(JSON.stringify(t)); newTemplate.id = 'grp_' + Date.now(); newTemplate.name = t.name + " Copy"; state.groupTemplates.push(newTemplate); saveGroupTemplates(); buildGroupsUI(); showToast(`Copied as "${newTemplate.name}"`); }
function deleteGroupTemplate(id) { const t = state.groupTemplates.find(g => g.id === id); if (!t) return; showCustomModal({ title: 'Delete Group', type: 'confirm', message: `Delete group template "${t.name}"?`, onConfirm: () => { state.groupTemplates = state.groupTemplates.filter(x => x.id !== id); saveGroupTemplates(); buildGroupsUI(); if(state.selectedPlankType === id) { state.selectedPlankType = '2x4'; ensureGhostPlank(); } showToast('Template deleted'); }}); }

function showSectionContextMenu(ev, section) {
    closeContextMenu(); const menu = document.createElement('div'); menu.className = 'context-menu'; menu.style.left = ev.clientX + 'px'; menu.style.top = ev.clientY + 'px';
    const renameItem = document.createElement('div'); renameItem.className = 'context-menu-item'; renameItem.textContent = '✏️ Rename';
    renameItem.onclick = () => { closeContextMenu(); showCustomModal({ title: 'Rename Section', type: 'prompt', defaultValue: section.name, onConfirm: (newName) => { if (newName && newName.trim()) { section.name = newName.trim(); saveMaterialsAndSections(); buildSectionsUI(); } }}); };
    menu.appendChild(renameItem);
    const sep = document.createElement('div'); sep.className = 'context-menu-sep'; menu.appendChild(sep);
    const deleteItem = document.createElement('div'); deleteItem.className = 'context-menu-item danger'; deleteItem.textContent = '🗑 Delete Section';
    deleteItem.onclick = () => { closeContextMenu(); const msg = section.materialIds.length > 0 ? `Delete section "${section.name}" and all its materials?` : `Delete section "${section.name}"?`; showCustomModal({ title: 'Delete Section', type: 'confirm', message: msg, onConfirm: () => { section.materialIds.forEach(matId => { delete state.materials[matId]; }); state.sections = state.sections.filter(s => s.id !== section.id); if (!state.materials[state.selectedPlankType]) state.selectedPlankType = null; saveMaterialsAndSections(); buildSectionsUI(); ensureGhostPlank(); showToast('Section deleted'); }}); };
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
    setTimeout(() => { document.addEventListener('click', closeContextMenu, { once: true }); }, 0);
}
function closeContextMenu() { const existing = document.querySelector('.context-menu'); if (existing) existing.remove(); }
window.cancelAddMaterial = () => { state.addingToSection = null; state.editingMaterialId = null; state.customTextureData = null; buildSectionsUI(); };
window.saveMaterial = (sectionId) => {
    const name = document.getElementById('newMatName').value.trim(); const w = parseFloat(document.getElementById('newMatW').value); const h = parseFloat(document.getElementById('newMatH').value); const l = parseFloat(document.getElementById('newMatL').value); const p = parseFloat(document.getElementById('newMatPrice').value) || 0.75; const tex = document.getElementById('newMatTexture').value;
    if (!name) { showToast('Please enter a name'); return; } if (!w || w <= 0) { showToast('Please enter a valid width'); return; } if (!h || h <= 0) { showToast('Please enter a valid height'); return; } if (!l || l <= 0) { showToast('Please enter a valid length'); return; }
    const matData = { w: w/12, h: h/12, defaultLength: l, name: name, pricePerBF: p, texture: tex };
    if (state.customTextureData) matData.textureData = state.customTextureData; else if (state.editingMaterialId && state.materials[state.editingMaterialId].textureData) matData.textureData = state.materials[state.editingMaterialId].textureData;
    if (state.editingMaterialId) { state.materials[state.editingMaterialId] = matData; if (textureCache[state.editingMaterialId]) { textureCache[state.editingMaterialId].dispose(); delete textureCache[state.editingMaterialId]; } showToast(`Updated "${name}"`); }
    else { const id = generateMaterialId(); state.materials[id] = matData; const section = state.sections.find(s => s.id === sectionId); if (section) section.materialIds.push(id); state.selectedPlankType = id; state.selectedLength = l; document.getElementById('lengthSelect').value = l; showToast(`Created "${name}"`); }
    state.addingToSection = null; state.editingMaterialId = null; state.customTextureData = null; saveMaterialsAndSections(); buildSectionsUI(); ensureGhostPlank();
};
function deleteMaterial(matId) {
    const mat = state.materials[matId]; if (!mat) return;
    showCustomModal({ title: 'Delete Material', type: 'confirm', message: `Delete "${mat.name}"?`, onConfirm: () => { state.sections.forEach(s => { s.materialIds = s.materialIds.filter(id => id !== matId); }); delete state.materials[matId]; if (textureCache[matId]) { textureCache[matId].dispose(); delete textureCache[matId]; } if (state.selectedPlankType === matId) state.selectedPlankType = null; saveMaterialsAndSections(); buildSectionsUI(); buildShapesUI(); ensureGhostPlank(); showToast('Material deleted'); }});
}

const playState = { velocity: new THREE.Vector3(), direction: new THREE.Vector3(), moveForward: false, moveBackward: false, moveLeft: false, moveRight: false, sprint: false, jump: false, onGround: false };
const PLAYER_HEIGHT = 5.5, PLAYER_RADIUS = 0.6, WALK_SPEED = 12, SPRINT_SPEED = 22, JUMP_VELOCITY = 16, GRAVITY = 40;
function playerCollides(pos) { const pBox = new THREE.Box3(new THREE.Vector3(pos.x-PLAYER_RADIUS,pos.y-PLAYER_HEIGHT,pos.z-PLAYER_RADIUS), new THREE.Vector3(pos.x+PLAYER_RADIUS,pos.y+0.2,pos.z+PLAYER_RADIUS)); for (const p of state.planks) { if (new THREE.Box3().setFromObject(p.mesh).intersectsBox(pBox)) return new THREE.Box3().setFromObject(p.mesh); } return null; }
function updatePlayMode(delta) {
    if (state.mode !== 'play') return; playerBody.rotation.set(0, yaw, 0, 'YXZ'); fpsCamera.rotation.set(pitch, 0, 0, 'YXZ');
    const speed = playState.sprint ? SPRINT_SPEED : WALK_SPEED; playState.direction.z = Number(playState.moveForward) - Number(playState.moveBackward); playState.direction.x = Number(playState.moveRight) - Number(playState.moveLeft); playState.direction.normalize();
    const forward = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yaw); const right = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    const move = new THREE.Vector3().addScaledVector(forward, playState.direction.z*speed*delta).addScaledVector(right, playState.direction.x*speed*delta);
    const tryPos = playerBody.position.clone(); tryPos.x += move.x; if (!playerCollides(tryPos)) playerBody.position.x = tryPos.x; tryPos.x = playerBody.position.x; tryPos.z += move.z; if (!playerCollides(tryPos)) playerBody.position.z = tryPos.z;
    if (playState.jump && playState.onGround) { playState.velocity.y = JUMP_VELOCITY; playState.onGround = false; } playState.velocity.y -= GRAVITY * delta; tryPos.copy(playerBody.position); tryPos.y += playState.velocity.y * delta;
    const hit = playerCollides(tryPos); if (hit) { if (playState.velocity.y < 0) { playerBody.position.y = hit.max.y + PLAYER_HEIGHT; playState.onGround = true; } playState.velocity.y = 0; } else { playerBody.position.y = tryPos.y; playState.onGround = false; }
    if (playerBody.position.y < PLAYER_HEIGHT) { playerBody.position.y = PLAYER_HEIGHT; playState.velocity.y = 0; playState.onGround = true; }
}
function ungroupObject(group) { const children = [...group.children].filter(c => c.isMesh || c.userData.plankType === 'group'); children.forEach(child => { scene.attach(child); state.planks.push({ mesh: child, type: child.userData.plankType, length: child.userData.plankLength }); state.multiSelection.add(child); }); scene.remove(group); const idx = state.planks.findIndex(p => p.mesh === group); if (idx >= 0) state.planks.splice(idx, 1); updateSelectionBoxes(); state.selectedObject = null; updatePropsPanel(); updatePlankCount(); pushHistory(); showToast('Ungrouped'); }

function updatePropsPanel() {
    const panel = document.getElementById('propsContent');
    const mesh = state.selectedObject;
    if (!mesh) {
        const type = state.selectedPlankType; const def = state.materials[type];
        if (def) {
            if (def.type === 'shape') {
                panel.innerHTML = `<div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">SELECTED SHAPE</h3><div class="prop-row"><label>Name</label><span style="font-size:12px;font-weight:bold;color:#daa520;">${def.name}</span></div><div class="prop-row"><label>Thickness</label><span style="font-size:12px;" title="Thickness: ${(def.thickness*12).toFixed(3)} inches">${(def.thickness*12).toFixed(2)}"</span></div><div class="prop-row"><label>Vertices</label><span style="font-size:12px;">${def.shapePoints.length}</span></div></div><p style="color:#666;font-size:11px;margin-top:8px;"><b>Ctrl+Click</b> on the ground to stamp it.</p>`;
            } else {
                const thickness = (def.w * 12).toFixed(2); const width = (def.h * 12).toFixed(2); const lengthFt = state.selectedLength;
                const bf = (parseFloat(thickness) * parseFloat(width) * lengthFt) / 12; const price = def.pricePerBF || 0.75;
                panel.innerHTML = `<div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">SELECTED MATERIAL</h3><div class="prop-row"><label>Name</label><span style="font-size:12px;font-weight:bold;color:#0a84ff;">${def.name}</span></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">DIMENSIONS</h3><div class="prop-row"><label>Thickness</label><span style="font-size:12px;" title="Thickness: ${thickness} inches">${thickness}"</span></div><div class="prop-row"><label>Width</label><span style="font-size:12px;" title="Width: ${width} inches">${width}"</span></div><div class="prop-row"><label>Length</label><span style="font-size:12px;" title="Length: ${lengthFt} ft">${lengthFt} ft (${(lengthFt*12).toFixed(1)}")</span></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">COST ESTIMATE</h3><div class="prop-row"><label>Board Ft</label><span style="font-size:12px;">${bf.toFixed(2)} BF</span></div><div class="prop-row"><label>Price/BF</label><span style="font-size:12px;">$${price.toFixed(2)}</span></div><div class="prop-row"><label>Est. Cost</label><span style="font-size:12px;color:#0f0;font-weight:bold;">$${(bf*price).toFixed(2)}</span></div></div><p style="color:#666;font-size:11px;margin-top:8px;"><b>Ctrl+Click</b> on the ground to place it.</p>`;
            }
        } else if (type.startsWith('grp_')) {
            const template = state.groupTemplates.find(g => g.id === type);
            if (template) panel.innerHTML = `<div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">SELECTED GROUP</h3><div class="prop-row"><label>Name</label><span style="font-size:12px;font-weight:bold;color:#4a9966;">${template.name}</span></div><div class="prop-row"><label>Parts</label><span style="font-size:12px;">${template.children.length} items</span></div></div><p style="color:#666;font-size:11px;margin-top:8px;"><b>Ctrl+Click</b> on the ground to stamp it.</p>`;
            else panel.innerHTML = `<p style="color:#666;font-size:12px;">No material selected.</p>`;
        } else { panel.innerHTML = `<p style="color:#666;font-size:12px;">No material selected.</p>`; }
        return;
    }
    if (mesh.userData.plankType === 'group') {
        const currentPrice = mesh.userData.pricePerBF !== undefined ? mesh.userData.pricePerBF : 0.00;
        const childCount = mesh.children.filter(c => c.isMesh).length;
        panel.innerHTML = `<div class="prop-group"><div class="prop-row"><label>Type</label><span style="font-size:12px;">Group (${childCount} planks)</span></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">PRICING OVERRIDE</h3><div class="prop-row"><label>Price/BF</label><input type="number" step="0.01" id="propPrice" value="${currentPrice}" title="Override price per Board Foot for this group"></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">NOTES</h3><textarea id="propNote" style="width:100%;height:50px;background:#1a1a1a;color:#ddd;border:1px solid #111;padding:4px;font-size:11px;border-radius:2px;resize:vertical;" title="Add notes or reminders for this group">${mesh.userData.note||''}</textarea><button id="saveNoteBtn" style="width:100%;margin-top:4px;background:#3a3a3a;color:#ddd;border:1px solid #111;padding:4px;cursor:pointer;border-radius:2px;font-size:11px;">Update Note</button></div><button id="ungroupBtn" style="width:100%;background:#3a3a3a;color:#ddd;border:1px solid #111;padding:6px;cursor:pointer;border-radius:3px;margin-bottom:4px;">Ungroup</button><button id="deleteBtn" style="width:100%;background:#8b2020;color:#ddd;border:1px solid #111;padding:6px;cursor:pointer;border-radius:3px;">Delete (Del)</button>`;
        document.getElementById('ungroupBtn').onclick = () => ungroupObject(mesh);
        document.getElementById('deleteBtn').onclick = () => { if (state.selectedObject) removePlank(state.selectedObject); };
        document.getElementById('saveNoteBtn').onclick = () => { updateMeshNote(mesh, document.getElementById('propNote').value); pushHistory(); showToast("Note updated"); };
        document.getElementById('propPrice').onchange = (ev) => { mesh.userData.pricePerBF = parseFloat(ev.target.value) || 0; pushHistory(); };
        return;
    }
    const type = mesh.userData.plankType; const lengthFt = mesh.userData.plankLength; const def = state.materials[type]; if (!def) return;
    if (def.type === 'shape') {
        const thkIn = (def.thickness * 12).toFixed(2);
        panel.innerHTML = `<div class="prop-group"><div class="prop-row"><label>Type</label><span style="font-size:12px;">${def.name}</span></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">SHAPE INFO</h3><div class="prop-row"><label>Thickness</label><span style="font-size:12px;">${thkIn}"</span></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">NOTES</h3><textarea id="propNote" style="width:100%;height:50px;background:#1a1a1a;color:#ddd;border:1px solid #111;padding:4px;font-size:11px;border-radius:2px;resize:vertical;">${mesh.userData.note||''}</textarea><button id="saveNoteBtn" style="width:100%;margin-top:4px;background:#3a3a3a;color:#ddd;border:1px solid #111;padding:4px;cursor:pointer;border-radius:2px;font-size:11px;">Update Note</button></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">POSITION (inches)</h3><div class="prop-row"><label>X</label><input type="number" step="1" id="posX" value="${(mesh.position.x*12).toFixed(1)}"></div><div class="prop-row"><label>Y</label><input type="number" step="1" id="posY" value="${(mesh.position.y*12).toFixed(1)}"></div><div class="prop-row"><label>Z</label><input type="number" step="1" id="posZ" value="${(mesh.position.z*12).toFixed(1)}"></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">ROTATION (deg)</h3><div class="prop-row"><label>X</label><input type="number" step="5" id="rotX" value="${THREE.MathUtils.radToDeg(mesh.rotation.x).toFixed(1)}"></div><div class="prop-row"><label>Y</label><input type="number" step="5" id="rotY" value="${THREE.MathUtils.radToDeg(mesh.rotation.y).toFixed(1)}"></div><div class="prop-row"><label>Z</label><input type="number" step="5" id="rotZ" value="${THREE.MathUtils.radToDeg(mesh.rotation.z).toFixed(1)}"></div></div><button id="duplicateBtn" style="width:100%;background:#3a3a3a;color:#ddd;border:1px solid #111;padding:6px;cursor:pointer;border-radius:3px;margin-bottom:4px;">Duplicate (Shift+D)</button><button id="deleteBtn" style="width:100%;background:#8b2020;color:#ddd;border:1px solid #111;padding:6px;cursor:pointer;border-radius:3px;">Delete (Del)</button>`;
        bindWithTooltip('posX', ev => { mesh.position.x = (parseFloat(ev.target.value)||0)/12; updateSelectionBox(); pushHistory(); }, v => `X: ${(parseFloat(v)||0).toFixed(2)}"`);
        bindWithTooltip('posY', ev => { mesh.position.y = (parseFloat(ev.target.value)||0)/12; updateSelectionBox(); pushHistory(); }, v => `Y: ${(parseFloat(v)||0).toFixed(2)}"`);
        bindWithTooltip('posZ', ev => { mesh.position.z = (parseFloat(ev.target.value)||0)/12; updateSelectionBox(); pushHistory(); }, v => `Z: ${(parseFloat(v)||0).toFixed(2)}"`);
        bindWithTooltip('rotX', ev => { mesh.rotation.x = THREE.MathUtils.degToRad(parseFloat(ev.target.value)||0); updateSelectionBox(); pushHistory(); }, v => `X Rot: ${(parseFloat(v)||0).toFixed(1)}°`);
        bindWithTooltip('rotY', ev => { mesh.rotation.y = THREE.MathUtils.degToRad(parseFloat(ev.target.value)||0); updateSelectionBox(); pushHistory(); }, v => `Y Rot: ${(parseFloat(v)||0).toFixed(1)}°`);
        bindWithTooltip('rotZ', ev => { mesh.rotation.z = THREE.MathUtils.degToRad(parseFloat(ev.target.value)||0); updateSelectionBox(); pushHistory(); }, v => `Z Rot: ${(parseFloat(v)||0).toFixed(1)}°`);
        document.getElementById('saveNoteBtn').onclick = () => { updateMeshNote(mesh, document.getElementById('propNote').value); pushHistory(); showToast("Note updated"); };
        document.getElementById('duplicateBtn').onclick = () => duplicateSelected();
        document.getElementById('deleteBtn').onclick = () => { if (state.selectedObject) removePlank(state.selectedObject); };
        return;
    }
    const thickness = def.w * 12 * mesh.scale.x; const width = def.h * 12 * mesh.scale.z;
    const actualLengthFt = lengthFt * mesh.scale.y; const lengthIn = actualLengthFt * 12;
    const bf = (thickness * width * actualLengthFt) / 12;
    const currentPrice = mesh.userData.pricePerBF !== undefined ? mesh.userData.pricePerBF : (def.pricePerBF || 0.75);
    const totalCost = bf * currentPrice;
    panel.innerHTML = `<div class="prop-group"><div class="prop-row"><label>Type</label><span style="font-size:12px;">${def.name}</span></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">DIMENSIONS (inches)</h3><div class="prop-row"><label>Thickness</label><input type="number" step="0.1" id="dimT" value="${thickness.toFixed(2)}"></div><div class="prop-row"><label>Width</label><input type="number" step="0.1" id="dimW" value="${width.toFixed(2)}"></div><div class="prop-row"><label>Length</label><input type="number" step="0.1" id="dimL" value="${lengthIn.toFixed(2)}"></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">PRICING</h3><div class="prop-row"><label>Board Ft</label><span style="font-size:12px;color:#aaa;">${bf.toFixed(2)} BF</span></div><div class="prop-row"><label>Price/BF</label><input type="number" step="0.01" id="propPrice" value="${currentPrice}"></div><div class="prop-row"><label>Est. Cost</label><span style="color:#0f0;font-weight:bold;">$${totalCost.toFixed(2)}</span></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">NOTES</h3><textarea id="propNote" style="width:100%;height:50px;background:#1a1a1a;color:#ddd;border:1px solid #111;padding:4px;font-size:11px;border-radius:2px;resize:vertical;">${mesh.userData.note||''}</textarea><button id="saveNoteBtn" style="width:100%;margin-top:4px;background:#3a3a3a;color:#ddd;border:1px solid #111;padding:4px;cursor:pointer;border-radius:2px;font-size:11px;">Update Note</button></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">POSITION (inches)</h3><div class="prop-row"><label>X</label><input type="number" step="1" id="posX" value="${(mesh.position.x*12).toFixed(1)}"></div><div class="prop-row"><label>Y</label><input type="number" step="1" id="posY" value="${(mesh.position.y*12).toFixed(1)}"></div><div class="prop-row"><label>Z</label><input type="number" step="1" id="posZ" value="${(mesh.position.z*12).toFixed(1)}"></div></div><div class="prop-group"><h3 style="font-size:10px;color:#888;margin-bottom:6px;">ROTATION (deg)</h3><div class="prop-row"><label>X</label><input type="number" step="5" id="rotX" value="${THREE.MathUtils.radToDeg(mesh.rotation.x).toFixed(1)}"></div><div class="prop-row"><label>Y</label><input type="number" step="5" id="rotY" value="${THREE.MathUtils.radToDeg(mesh.rotation.y).toFixed(1)}"></div><div class="prop-row"><label>Z</label><input type="number" step="5" id="rotZ" value="${THREE.MathUtils.radToDeg(mesh.rotation.z).toFixed(1)}"></div></div><button id="duplicateBtn" style="width:100%;background:#3a3a3a;color:#ddd;border:1px solid #111;padding:6px;cursor:pointer;border-radius:3px;margin-bottom:4px;">Duplicate (Shift+D)</button><button id="deleteBtn" style="width:100%;background:#8b2020;color:#ddd;border:1px solid #111;padding:6px;cursor:pointer;border-radius:3px;">Delete (Del)</button>`;
    bindWithTooltip('dimT', ev => { mesh.scale.x = (parseFloat(ev.target.value)||(def.w*12))/(def.w*12); updateSelectionBox(); updatePropsPanel(); pushHistory(); }, v => `Thickness: ${parseFloat(v).toFixed(3)}"`);
    bindWithTooltip('dimW', ev => { mesh.scale.z = (parseFloat(ev.target.value)||(def.h*12))/(def.h*12); updateSelectionBox(); updatePropsPanel(); pushHistory(); }, v => `Width: ${parseFloat(v).toFixed(3)}"`);
    bindWithTooltip('dimL', ev => { mesh.scale.y = (parseFloat(ev.target.value)||(lengthFt*12))/(lengthFt*12); updateSelectionBox(); updatePropsPanel(); pushHistory(); }, v => `Length: ${parseFloat(v).toFixed(3)}"`);
    bindWithTooltip('posX', ev => { mesh.position.x = (parseFloat(ev.target.value)||0)/12; updateSelectionBox(); pushHistory(); }, v => `X: ${(parseFloat(v)||0).toFixed(2)}"`);
    bindWithTooltip('posY', ev => { mesh.position.y = (parseFloat(ev.target.value)||0)/12; updateSelectionBox(); pushHistory(); }, v => `Y: ${(parseFloat(v)||0).toFixed(2)}"`);
    bindWithTooltip('posZ', ev => { mesh.position.z = (parseFloat(ev.target.value)||0)/12; updateSelectionBox(); pushHistory(); }, v => `Z: ${(parseFloat(v)||0).toFixed(2)}"`);
    bindWithTooltip('rotX', ev => { mesh.rotation.x = THREE.MathUtils.degToRad(parseFloat(ev.target.value)||0); updateSelectionBox(); pushHistory(); }, v => `X Rot: ${(parseFloat(v)||0).toFixed(1)}°`);
    bindWithTooltip('rotY', ev => { mesh.rotation.y = THREE.MathUtils.degToRad(parseFloat(ev.target.value)||0); updateSelectionBox(); pushHistory(); }, v => `Y Rot: ${(parseFloat(v)||0).toFixed(1)}°`);
    bindWithTooltip('rotZ', ev => { mesh.rotation.z = THREE.MathUtils.degToRad(parseFloat(ev.target.value)||0); updateSelectionBox(); pushHistory(); }, v => `Z Rot: ${(parseFloat(v)||0).toFixed(1)}°`);
    document.getElementById('saveNoteBtn').onclick = () => { updateMeshNote(mesh, document.getElementById('propNote').value); pushHistory(); showToast("Note updated"); };
    document.getElementById('propPrice').onchange = (ev) => { mesh.userData.pricePerBF = parseFloat(ev.target.value) || 0; updatePropsPanel(); pushHistory(); };
    document.getElementById('duplicateBtn').onclick = () => duplicateSelected();
    document.getElementById('deleteBtn').onclick = () => { if (state.selectedObject) removePlank(state.selectedObject); };
}

function updateSelectionBox() { if (state.selectedObject) selectionBox.setFromObject(state.selectedObject); }
function updatePlankCount() { document.getElementById('plankCount').textContent = `Planks: ${state.planks.length}`; }
function updateMeasureCount() { document.getElementById('measureCount').textContent = `Measures: ${state.measurements.length}`; }
function duplicateSelected() { if (!state.selectedObject) return; const m = state.selectedObject; const newMesh = addPlank(m.userData.plankType, m.userData.plankLength, m.position.clone().add(new THREE.Vector3(1,0,0)), m.rotation.clone()); newMesh.scale.copy(m.scale); selectObject(newMesh); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(showToast._t); showToast._t = setTimeout(() => t.classList.remove('show'), 2500); }
function toggleHelp() { const h = document.getElementById('helpModal'); h.style.display = h.style.display === 'block' ? 'none' : 'block'; }

function setViewMode(mode) {
    state.viewMode = mode; state.maximizedView = null; const btn = document.getElementById('viewModeBtn');
    document.getElementById('viewStatus').textContent = `View: ${mode === '3d' ? '3D' : '2D Multi'}`;
    if (mode === '2d') { activeCamera = views[0].camera; transformControls.camera = views[0].camera; orbitControls.enabled = false; views.forEach((v, i) => { v.controls.enabled = (i === 0); }); state.activeViewIndex = 0; }
    else { activeCamera = editorCamera; transformControls.camera = editorCamera; orbitControls.enabled = true; views.forEach(v => { v.controls.enabled = false; }); renderer.setScissorTest(false); renderer.setViewport(0, 0, viewport.clientWidth, viewport.clientHeight); }
    updateCameraAspectRatios(); updateViewLayout(); if (state.selectedObject) { transformControls.detach(); transformControls.attach(state.selectedObject); }
}
function setMaximizedView(viewIndex) { state.maximizedView = state.maximizedView === viewIndex ? null : viewIndex; updateCameraAspectRatios(); updateViewLayout(); if (state.selectedObject && state.viewMode === '2d') { transformControls.camera = views[state.activeViewIndex].camera; transformControls.detach(); transformControls.attach(state.selectedObject); } }
function setMode(mode) {
    state.mode = mode; document.getElementById('modeStatus').textContent = `Mode: ${mode === 'editor' ? 'Editor' : 'Play'}`;
    document.getElementById('crosshair').style.display = mode === 'play' ? 'block' : 'none'; if (mode !== 'editor') setMeasureMode(false);
    document.getElementById('hintText').textContent = mode === 'editor' ? 'Ctrl+Click ground to place • Left click to select' : 'Right-click & drag to look • WASD to move • ESC for editor';
    if (mode === 'editor') { if (state.viewMode === '2d') { activeCamera = views[0].camera; transformControls.camera = views[0].camera; orbitControls.enabled = false; } else { activeCamera = editorCamera; transformControls.camera = editorCamera; orbitControls.enabled = true; } isLooking = false; viewport.classList.remove('looking'); document.getElementById('playOverlay').style.display = 'none'; if (state.selectedObject) transformControls.attach(state.selectedObject); transformControls.visible = true; ensureGhostPlank(); playState.velocity.set(0,0,0); }
    else { if (state.viewMode === '2d') setViewMode('3d'); activeCamera = fpsCamera; transformControls.detach(); transformControls.visible = false; if (state.ghostPlank) state.ghostPlank.visible = false; orbitControls.enabled = false; views.forEach(v => { v.controls.enabled = false; }); playerBody.position.set(editorCamera.position.x, Math.max(editorCamera.position.y, PLAYER_HEIGHT), editorCamera.position.z); yaw = 0; pitch = 0; isLooking = false; document.getElementById('playOverlay').style.display = 'block'; playState.velocity.set(0,0,0); playState.onGround = true; }
}

let mouseDownInfo = null;
renderer.domElement.addEventListener('mousedown', ev => {
    if (state.mode !== 'editor') return; if (ev.button !== 0) return;
    mouseDownInfo = { x: ev.clientX, y: ev.clientY, button: ev.button, ctrl: ev.ctrlKey };
    if (state.viewMode === '2d') { const viewIndex = getViewIndexAtPoint(ev.clientX, ev.clientY); if (viewIndex >= 0) { state.activeViewIndex = viewIndex; transformControls.camera = views[viewIndex].camera; views.forEach((v, i) => { v.controls.enabled = (i === viewIndex); }); } }
});
renderer.domElement.addEventListener('mouseup', ev => {
    if (!mouseDownInfo || state.mode !== 'editor') return;
    const moved = Math.hypot(ev.clientX - mouseDownInfo.x, ev.clientY - mouseDownInfo.y) > 5;
    const wasLeftClick = mouseDownInfo.button === 0; const wasCtrlClick = mouseDownInfo.ctrl || ev.ctrlKey; const wasShiftClick = ev.shiftKey;
    mouseDownInfo = null; if (moved || !wasLeftClick) return; if (state.isDraggingGizmo) return;
    const hits = raycastEditor(ev, [...state.planks.map(p => p.mesh), ground]); if (hits.length === 0) return; const hit = hits[0];
    let hitObject = hit.object; let current = hitObject; while (current) { if (state.planks.some(p => p.mesh === current)) { hitObject = current; break; } current = current.parent; }
    if (draw2DState.active && hitObject.userData.isGround) { const p = hit.point; if (draw2DState.type === 'circle' || draw2DState.type === 'rect') { if (!draw2DState.startPoint) draw2DState.startPoint = p.clone(); else { draw2DState.endPoint = p.clone(); finish2DDraw(); } } else if (draw2DState.type === 'poly') draw2DState.points.push(p.clone()); return; }
    if (state.isDrawingShape) { if (hitObject.userData.isGround) { state.shapePoints.push([hit.point.x, hit.point.z]); updateShapeLine(); } return; }
    if (state.measureMode) { const clickPoint = hit.point.clone(); if (!state.measureStartPoint) { state.measureStartPoint = clickPoint; document.getElementById('hintText').textContent = 'Click second point to complete measurement • ESC to cancel'; showToast('Start point set'); } else { createMeasurement(state.measureStartPoint, clickPoint); clearPendingMeasure(); document.getElementById('hintText').textContent = 'Click first point to start another measurement • ESC to exit'; } return; }
    if (wasCtrlClick && (hitObject.userData.isGround || hitObject.userData.isPlank)) {
        const pos = hit.point.clone();
        if (hitObject.userData.isGround) { if (state.gridSnap) { pos.x = Math.round(pos.x * 2) / 2; pos.z = Math.round(pos.z * 2) / 2; } pos.y = state.selectedPlankType.startsWith('grp_') ? 0 : (state.materials[state.selectedPlankType].type === 'shape' ? 0 : state.selectedLength / 2); }
        else if (hitObject.userData.isPlank && !state.selectedPlankType.startsWith('grp_') && state.materials[state.selectedPlankType].type !== 'shape') { const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); const def = state.materials[state.selectedPlankType]; if(def) { const halfSize = new THREE.Vector3(def.w / 2, state.selectedLength / 2, def.h / 2); const offset = new THREE.Vector3(); const absX = Math.abs(normal.x), absY = Math.abs(normal.y), absZ = Math.abs(normal.z); if(absX>absY&&absX>absZ) offset.x=Math.sign(normal.x)*halfSize.x; else if(absY>absX&&absY>absZ) offset.y=Math.sign(normal.y)*halfSize.y; else offset.z=Math.sign(normal.z)*halfSize.z; pos.add(offset); } }
        if (state.selectedPlankType.startsWith('grp_')) { const template = state.groupTemplates.find(g => g.id === state.selectedPlankType); if (template) { const group = new THREE.Group(); group.userData.isPlank = true; group.userData.plankType = 'group'; group.userData.isTemplateInstance = true; group.userData.templateId = template.id; template.children.forEach(cData => { const child = deserializeMesh(cData); if(child) group.add(child); }); group.position.copy(pos); scene.add(group); state.planks.push({ mesh: group, type: 'group', length: 0 }); selectObject(group); updatePlankCount(); pushHistory(); } return; }
        selectObject(addPlank(state.selectedPlankType, state.selectedLength, pos)); return;
    }
    if (hitObject.userData.isPlank) { if (wasShiftClick) { if (state.multiSelection.has(hitObject)) state.multiSelection.delete(hitObject); else state.multiSelection.add(hitObject); updateSelectionBoxes(); } else { state.multiSelection.clear(); state.multiSelection.add(hitObject); updateSelectionBoxes(); selectObject(hitObject); } }
    else { if (!wasShiftClick) { state.multiSelection.clear(); updateSelectionBoxes(); selectObject(null); } }
});
renderer.domElement.addEventListener('mousemove', ev => {
    if (state.mode !== 'editor') return; const hits = raycastEditor(ev, [ground, ...state.planks.map(p => p.mesh)]);
    if (draw2DState.active && hits.length > 0 && hits[0].object.userData.isGround) { update2DPreview(hits[0].point); return; }
    if (state.measureMode && state.measureStartPoint && hits.length > 0) { updatePendingMeasureLine(hits[0].point); }
    if (!state.measureMode && !state.isDrawingShape) {
        const ghost = state.ghostPlank; if (!ghost) return;
        if (state.ctrlPressed && hits.length > 0) { const p = hits[0].point; document.getElementById('cursorPos').textContent = `Cursor: ${(p.x*12).toFixed(1)}", ${(p.y*12).toFixed(1)}", ${(p.z*12).toFixed(1)}"`; let gx=p.x, gz=p.z, gy=p.y; if(hits[0].object.userData.isGround){if(state.gridSnap){gx=Math.round(gx*2)/2;gz=Math.round(gz*2)/2;} gy=state.selectedPlankType.startsWith('grp_')?0:(state.materials[state.selectedPlankType].type==='shape'?0:state.selectedLength/2);} ghost.position.set(gx,gy,gz); ghost.visible = true; }
        else { if(ghost) ghost.visible=false; if(hits.length>0&&hits[0].object.userData.isGround){const p=hits[0].point; document.getElementById('cursorPos').textContent=`Cursor: ${(p.x*12).toFixed(1)}", ${(p.y*12).toFixed(1)}", ${(p.z*12).toFixed(1)}"`;} }
    } else { if(hits.length>0&&hits[0].object.userData.isGround){const p=hits[0].point; document.getElementById('cursorPos').textContent=`Cursor: ${(p.x*12).toFixed(1)}", ${(p.y*12).toFixed(1)}", ${(p.z*12).toFixed(1)}"`;} if(state.ghostPlank&&!state.isDrawingShape) state.ghostPlank.visible=false; }
});
renderer.domElement.addEventListener('dblclick', ev => { if (state.mode !== 'editor' || state.viewMode !== '2d') return; const viewIndex = getViewIndexAtPoint(ev.clientX, ev.clientY); if (viewIndex >= 0) { setMaximizedView(viewIndex); state.activeViewIndex = viewIndex; transformControls.camera = views[viewIndex].camera; views.forEach((v, i) => { v.controls.enabled = (i === viewIndex); }); } });

function isTypingInInput() { const el = document.activeElement; if (!el) return false; const tag = el.tagName.toLowerCase(); return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable; }
window.addEventListener('keydown', ev => {
    const typing = isTypingInInput(); if (ev.code === 'F1') { ev.preventDefault(); toggleHelp(); return; } if (typing) return;
    if (draw2DState.active && ev.key === 'Enter' && draw2DState.type === 'poly') { finish2DDraw(); return; }
    if (draw2DState.active && ev.key === 'Escape') { cancel2DDraw(); return; }
    if (ev.code === 'Escape') { if (state.isDrawingShape) { cancelDrawingShape(); return; } if (state.measureMode) { setMeasureMode(false); return; } }
    if (state.mode === 'play') { switch (ev.code) { case 'KeyW': playState.moveForward = true; break; case 'KeyS': playState.moveBackward = true; break; case 'KeyA': playState.moveLeft = true; break; case 'KeyD': playState.moveRight = true; break; case 'Space': playState.jump = true; ev.preventDefault(); break; case 'ShiftLeft': case 'ShiftRight': playState.sprint = true; break; case 'Escape': setMode('editor'); break; } return; }
    if (ev.code === 'KeyV' && state.mode === 'editor' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) { setViewMode(state.viewMode === '3d' ? '2d' : '3d'); return; }
    if (ev.code === 'KeyM' && state.mode === 'editor' && !ev.ctrlKey && !ev.altKey) { setMeasureMode(!state.measureMode); return; }
    if (ev.ctrlKey || ev.metaKey) { if (ev.code === 'KeyZ') { ev.preventDefault(); undo(); return; } if (ev.code === 'KeyY' || (ev.shiftKey && ev.code === 'KeyZ')) { ev.preventDefault(); redo(); return; } }
    if (ev.shiftKey && ev.code === 'KeyD') { ev.preventDefault(); duplicateSelected(); return; }
    switch (ev.code) {
        case 'Delete': case 'Backspace': if (state.selectedObject) removePlank(state.selectedObject); break;
        case 'KeyG': transformControls.setMode('translate'); break; case 'KeyR': transformControls.setMode('rotate'); break; case 'KeyS': if (!ev.ctrlKey) transformControls.setMode('scale'); break;
        case 'KeyX': transformControls.showX = true; transformControls.showY = false; transformControls.showZ = false; break;
        case 'KeyY': transformControls.showX = false; transformControls.showY = true; transformControls.showZ = false; break;
        case 'KeyZ': if (!ev.ctrlKey) { transformControls.showX = false; transformControls.showY = false; transformControls.showZ = true; } break;
        case 'Escape': transformControls.showX = true; transformControls.showY = true; transformControls.showZ = true; document.getElementById('helpModal').style.display = 'none'; break;
        case 'KeyF': if (state.selectedObject) { if (state.viewMode === '3d') orbitControls.target.copy(state.selectedObject.position); else views.forEach(v => { v.controls.target.copy(state.selectedObject.position); v.controls.update(); }); } break;
    }
});
window.addEventListener('keyup', ev => { if (state.mode !== 'play') return; switch (ev.code) { case 'KeyW': playState.moveForward = false; break; case 'KeyS': playState.moveBackward = false; break; case 'KeyA': playState.moveLeft = false; break; case 'KeyD': playState.moveRight = false; break; case 'Space': playState.jump = false; break; case 'ShiftLeft': case 'ShiftRight': playState.sprint = false; break; } });

// === MENU BINDINGS ===
document.getElementById('editorBtn').onclick = () => { setMode('editor'); document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); };
document.getElementById('playBtn').onclick = () => { setMode('play'); document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); };
document.getElementById('viewModeBtn').onclick = () => { setViewMode(state.viewMode === '3d' ? '2d' : '3d'); document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); };
document.getElementById('undoBtn').onclick = () => { undo(); document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); };
document.getElementById('redoBtn').onclick = () => { redo(); document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); };
document.getElementById('clearBtn').onclick = () => { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); if (state.planks.length === 0) return; showCustomModal({ title: 'Clear All', type: 'confirm', message: 'Clear all planks?', onConfirm: () => { for (const p of [...state.planks]) { scene.remove(p.mesh); p.mesh.traverse(child => { if (child.geometry) child.geometry.dispose(); if (child.material) { if (child.material.map) child.material.map.dispose(); child.material.dispose(); } }); } state.planks = []; selectObject(null); updatePlankCount(); pushHistory(); }}); };

// === SAVE PROJECT (Save As) ===
document.getElementById('saveBtn').onclick = () => {
    document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
    showCustomModal({
        title: 'Save Project',
        type: 'prompt',
        defaultValue: state.currentProjectName,
        placeholder: 'Project name',
        onConfirm: (name) => {
            if (!name || !name.trim()) { showToast('Please enter a project name'); return; }
            saveCurrentProject(name.trim());
        }
    });
};

// === LOAD PROJECT (Project Manager) ===
document.getElementById('loadBtn').onclick = () => {
    document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
    openProjectManager();
};

// === EXPORT PROJECT (.woodproj) ===
document.getElementById('exportProjectBtn').onclick = () => {
    document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
    const data = getCurrentProjectData();
    data.projectName = state.currentProjectName;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${state.currentProjectName.replace(/[^a-z0-9]/gi, '_')}.woodproj`;
    link.click();
    showToast(`Exported: ${state.currentProjectName}.woodproj`);
};

// === IMPORT PROJECT (.woodproj) ===
document.getElementById('importProjectBtn').onclick = () => document.getElementById('importProjectInput').click();
document.getElementById('importProjectInput').onchange = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
    const reader = new FileReader();
    reader.onload = (re) => {
        try {
            const data = JSON.parse(re.target.result);
            const projectName = data.projectName || file.name.replace(/\.[^.]+$/, '');
            const projects = getAllProjects();
            // If project name exists, append timestamp
            let finalName = projectName;
            if (projects[finalName]) finalName = projectName + ' (' + new Date().toLocaleDateString() + ')';
            data.savedAt = new Date().toISOString();
            projects[finalName] = data;
            saveAllProjects(projects);
            loadProjectData(data);
            state.currentProjectName = finalName;
            updateProjectNameDisplay();
            showToast(`Imported: ${finalName}`);
        } catch (err) { showToast('Import failed: Invalid file format'); }
    };
    reader.readAsText(file);
    ev.target.value = '';
};

// === IMPORT MODEL (GLTF/GLB) ===
const gltfLoader = new GLTFLoader();
document.getElementById('importModelBtn').onclick = () => document.getElementById('modelFileInput').click();
document.getElementById('modelFileInput').onchange = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
    showToast('Importing model...');
    const url = URL.createObjectURL(file);
    gltfLoader.load(url, (gltf) => {
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const center = new THREE.Vector3(); box.getCenter(center);
        model.position.sub(center);
        const wrapper = new THREE.Group();
        wrapper.add(model);
        wrapper.position.copy(center);
        wrapper.userData.isPlank = true;
        wrapper.userData.plankType = 'imported_model';
        wrapper.userData.plankLength = 0;
        wrapper.userData.name = file.name.replace(/\.[^.]+$/, '');
        wrapper.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
        scene.add(wrapper);
        state.planks.push({ mesh: wrapper, type: 'imported_model', length: 0 });
        selectObject(wrapper);
        updatePlankCount();
        pushHistory();
        showToast(`Imported: ${file.name}`);
        URL.revokeObjectURL(url);
    }, undefined, (err) => { showToast('Import failed: ' + err.message); });
    ev.target.value = '';
};

// === EXPORT MODEL (GLTF/OBJ) ===
document.getElementById('exportModelBtn').onclick = () => {
    document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
    showCustomModal({ title: 'Export Model Format', type: 'prompt', defaultValue: 'gltf', placeholder: 'gltf or obj', onConfirm: (format) => {
        if (!format) return;
        const exportScene = new THREE.Scene(); exportScene.add(new THREE.AmbientLight(0xffffff, 0.5)); const expSun = new THREE.DirectionalLight(0xffffff, 1); expSun.position.copy(sun.position); exportScene.add(expSun);
        state.planks.forEach(p => { const clone = p.mesh.clone(); clone.updateMatrixWorld(true); exportScene.add(clone); });
        if (format.toLowerCase() === 'gltf') { const exporter = new GLTFExporter(); exporter.parse(exportScene, (result) => { saveString(JSON.stringify(result, null, 2), 'wood-builder-model.gltf'); showToast('Exported as GLTF'); }, (error) => { showToast('Export failed: ' + error.message); }, { binary: false }); }
        else if (format.toLowerCase() === 'obj') { const exporter = new OBJExporter(); saveString(exporter.parse(exportScene), 'wood-builder-model.obj'); showToast('Exported as OBJ'); }
        else showToast('Unknown format. Use gltf or obj');
    }});
};

document.getElementById('modelerToolBtn').onclick = () => { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); window.location.href = 'Modeler.html'; };
document.getElementById('miterSawBtn').onclick = () => { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); window.location.href = 'Miter Saw Tool.html'; };
document.getElementById('bomBtn').onclick = () => {
    document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open'));
    let totalBF = 0, totalCost = 0; const summary = {};
    function processMesh(mesh) {
        const type = mesh.userData.plankType; const length = mesh.userData.plankLength; const def = state.materials[type];
        if (!def || type === 'group') return;
        if (def.type === 'shape') { const box = new THREE.Box3().setFromObject(mesh); const size = new THREE.Vector3(); box.getSize(size); const vol = size.x*size.y*size.z; const bf = vol*12; const price = def.pricePerBF||1.00; const cost = bf*price; totalBF += bf; totalCost += cost; const key = `${def.name} (Shape)`; if (!summary[key]) summary[key] = { count: 0, bf: 0, cost: 0, price: price }; summary[key].count++; summary[key].bf += bf; summary[key].cost += cost; return; }
        const thicknessIn = def.w*12*mesh.scale.x; const widthIn = def.h*12*mesh.scale.z; const lengthFt = length*mesh.scale.y;
        const bf = (thicknessIn*widthIn*lengthFt)/12; const price = mesh.userData.pricePerBF !== undefined ? mesh.userData.pricePerBF : (def.pricePerBF||0.75); const cost = bf*price; totalBF += bf; totalCost += cost;
        const key = `${def.name} @ ${lengthFt.toFixed(1)}'`; if (!summary[key]) summary[key] = { count: 0, bf: 0, cost: 0, price: price }; summary[key].count++; summary[key].bf += bf; summary[key].cost += cost;
    }
    state.planks.forEach(p => { if (p.mesh.userData.plankType === 'group') p.mesh.traverse(child => { if (child.isMesh) processMesh(child); }); else processMesh(p.mesh); });
    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3 style="color:#0a84ff;margin:0;">🧾 Bill of Materials</h3><div><button onclick="window.print()" style="padding:6px 16px;background:#0a84ff;color:white;border:none;border-radius:4px;cursor:pointer;margin-right:8px;">🖨️ Print</button><button onclick="document.getElementById('bomModal').style.display='none'" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">×</button></div></div>`;
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse;"><tr style="border-bottom:2px solid #444;"><th style="text-align:left;padding:6px;">Item</th><th>Qty</th><th>Board Ft</th><th>Price/BF</th><th>Cost</th></tr>';
    let rowIdx = 0;
    for (const [key, val] of Object.entries(summary)) {
        html += `<tr style="border-bottom:1px solid #333;"><td style="padding:6px;">${key}</td><td style="text-align:center;">${val.count}</td><td style="text-align:center;">${val.bf.toFixed(1)}</td><td style="text-align:center;"><input type="number" step="0.01" min="0" value="${val.price.toFixed(2)}" data-bom-row="${rowIdx}" style="width:70px;text-align:center;background:#1a1a1a;color:#ddd;border:1px solid #111;border-radius:2px;"></td><td style="text-align:center;" data-cost-cell="${rowIdx}">$${val.cost.toFixed(2)}</td></tr>`;
        rowIdx++;
    }
    html += `<tr style="font-weight:bold;color:#0a84ff;border-top:2px solid #0a84ff;"><td style="padding:8px 6px;">TOTAL</td><td style="text-align:center;">${state.planks.length}</td><td style="text-align:center;">${totalBF.toFixed(1)}</td><td></td><td style="text-align:center;" id="bomTotalCost">$${totalCost.toFixed(2)}</td></tr></table>`;
    document.getElementById('bomContent').innerHTML = html;
    document.getElementById('bomModal').style.display = 'block';
    document.querySelectorAll('[data-bom-row]').forEach(input => {
        input.addEventListener('change', (iev) => {
            const idx = parseInt(iev.target.dataset.bomRow); const newPrice = parseFloat(iev.target.value) || 0;
            const keys = Object.keys(summary);
            if (keys[idx]) { summary[keys[idx]].price = newPrice; summary[keys[idx]].cost = summary[keys[idx]].bf * newPrice; const costCell = document.querySelector(`[data-cost-cell="${idx}"]`); if (costCell) costCell.textContent = `$${summary[keys[idx]].cost.toFixed(2)}`; let newTotal = 0; Object.values(summary).forEach(v => { newTotal += v.cost; }); const totalEl = document.getElementById('bomTotalCost'); if (totalEl) totalEl.textContent = `$${newTotal.toFixed(2)}`; }
        });
    });
};
document.getElementById('measureBtn').onclick = () => { setMeasureMode(!state.measureMode); document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); };
document.getElementById('clearMeasureBtn').onclick = () => { clearAllMeasurements(); document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); };
document.getElementById('newSectionBtn').onclick = () => showNewSectionForm();
document.getElementById('drawShapeBtn').onclick = () => { if (state.isDrawingShape) finishDrawingShape(); else startDrawingShape(); document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); };
document.getElementById('draw2DBtn').onclick = () => { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); const menu = document.createElement('div'); menu.style.cssText = 'position:fixed;top:50px;left:50%;transform:translateX(-50%);background:#2a2a2a;border:1px solid #0a84ff;padding:10px;border-radius:8px;z-index:2000;display:flex;gap:10px;'; menu.innerHTML = `<button style="padding:8px 16px;background:#0a84ff;color:white;border:none;border-radius:4px;cursor:pointer;" id="drawCircleBtn">⭕ Circle</button><button style="padding:8px 16px;background:#0a84ff;color:white;border:none;border-radius:4px;cursor:pointer;" id="drawRectBtn">⬛ Rectangle</button><button style="padding:8px 16px;background:#0a84ff;color:white;border:none;border-radius:4px;cursor:pointer;" id="drawPolyBtn">🔺 Polygon</button><button style="padding:8px 16px;background:#444;color:white;border:none;border-radius:4px;cursor:pointer;" id="drawCancelBtn">×</button>`; document.body.appendChild(menu); document.getElementById('drawCircleBtn').onclick = () => { document.body.removeChild(menu); start2DDraw('circle'); }; document.getElementById('drawRectBtn').onclick = () => { document.body.removeChild(menu); start2DDraw('rect'); }; document.getElementById('drawPolyBtn').onclick = () => { document.body.removeChild(menu); start2DDraw('poly'); }; document.getElementById('drawCancelBtn').onclick = () => { document.body.removeChild(menu); }; };
document.getElementById('cutShapeBtn').onclick = () => { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); if (!state.selectedObject) { showToast("Select a plank to cut first!"); return; } const menu = document.createElement('div'); menu.style.cssText = 'position:fixed;top:50px;left:50%;transform:translateX(-50%);background:#2a2a2a;border:1px solid #c0392b;padding:10px;border-radius:8px;z-index:2000;display:flex;gap:10px;'; menu.innerHTML = `<div style="color:#fff;padding:8px;font-weight:bold;border-right:1px solid #444;margin-right:5px;">CUT MODE</div><button style="padding:8px 16px;background:#c0392b;color:white;border:none;border-radius:4px;cursor:pointer;" id="cutCircleBtn">⭕ Circle</button><button style="padding:8px 16px;background:#c0392b;color:white;border:none;border-radius:4px;cursor:pointer;" id="cutRectBtn">⬛ Rect</button><button style="padding:8px 16px;background:#c0392b;color:white;border:none;border-radius:4px;cursor:pointer;" id="cutPolyBtn">🔺 Poly</button><button style="padding:8px 16px;background:#444;color:white;border:none;border-radius:4px;cursor:pointer;" id="cutCancelBtn">×</button>`; document.body.appendChild(menu); document.getElementById('cutCircleBtn').onclick = () => { document.body.removeChild(menu); start2DDraw('circle', 'cut'); }; document.getElementById('cutRectBtn').onclick = () => { document.body.removeChild(menu); start2DDraw('rect', 'cut'); }; document.getElementById('cutPolyBtn').onclick = () => { document.body.removeChild(menu); start2DDraw('poly', 'cut'); }; document.getElementById('cutCancelBtn').onclick = () => { document.body.removeChild(menu); }; };
document.getElementById('groupBtn').onclick = () => { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); const toGroup = state.multiSelection.size > 0 ? Array.from(state.multiSelection) : (state.selectedObject ? [state.selectedObject] : []); if (toGroup.length < 2) { showToast('Select at least 2 planks to group (Shift+Click)'); return; } showCustomModal({ title: 'Name Group Component', type: 'prompt', defaultValue: 'Custom Group', placeholder: "e.g. 'Truss A'", onConfirm: (name) => { if (!name) return; const group = new THREE.Group(); group.userData.isPlank = true; group.userData.plankType = 'group'; group.userData.plankLength = 0; toGroup.forEach(mesh => { scene.remove(mesh); group.add(mesh); const idx = state.planks.findIndex(p => p.mesh === mesh); if (idx >= 0) state.planks.splice(idx, 1); }); scene.add(group); state.planks.push({ mesh: group, type: 'group', length: 0 }); const template = { id: 'grp_' + Date.now(), name: name, children: [] }; group.children.filter(c => c.isMesh || c.userData.plankType === 'group').forEach(c => { template.children.push(serializeMesh(c)); }); state.groupTemplates.push(template); saveGroupTemplates(); buildGroupsUI(); state.multiSelection.clear(); updateSelectionBoxes(); selectObject(group); updatePlankCount(); pushHistory(); showToast(`Grouped ${toGroup.length} planks as "${name}"`); }}); };
document.getElementById('noteBtn').onclick = () => { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); if (!state.selectedObject) { showToast("Select a plank or group first"); return; } showCustomModal({ title: 'Edit Note', type: 'prompt', defaultValue: state.selectedObject.userData.note || '', onConfirm: (text) => { if (text !== null) { updateMeshNote(state.selectedObject, text); updatePropsPanel(); pushHistory(); } }}); };
function saveString(text, filename) { const blob = new Blob([text], { type: 'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); }
document.getElementById('lengthSelect').onchange = ev => { state.selectedLength = parseFloat(ev.target.value); ensureGhostPlank(); if (!state.selectedObject) updatePropsPanel(); };
document.getElementById('gridSnap').onchange = ev => { state.gridSnap = ev.target.checked; transformControls.setTranslationSnap(state.gridSnap ? 0.5 : null); };
document.getElementById('rotSnap').onchange = ev => { state.rotSnap = ev.target.checked; transformControls.setRotationSnap(state.rotSnap ? THREE.MathUtils.degToRad(15) : null); };
document.getElementById('showGrid').onchange = ev => { grid.visible = ev.target.checked; };
document.getElementById('helpBtn').onclick = toggleHelp;
const sensitivitySlider = document.getElementById('sensitivitySlider'); const sensitivityValue = document.getElementById('sensitivityValue');
sensitivitySlider.value = state.lookSensitivity; sensitivityValue.textContent = state.lookSensitivity.toFixed(0);
sensitivitySlider.oninput = ev => { state.lookSensitivity = parseFloat(ev.target.value); sensitivityValue.textContent = state.lookSensitivity.toFixed(0); localStorage.setItem('lookSensitivity', state.lookSensitivity.toString()); };
const timeSlider = document.getElementById('timeSlider'); const timeValue = document.getElementById('timeValue');
function updateTimeOfDay(time) { const angle = (time / 24) * Math.PI * 2; sun.position.set(Math.cos(angle)*100, Math.sin(angle)*100, 50); if (time < 6 || time > 20) { sun.intensity = 0.1; sun.color.setHex(0x333355); scene.background.setHex(0x111122); scene.fog.color.setHex(0x111122); } else if (time < 8 || time > 18) { sun.intensity = 0.6; sun.color.setHex(0xffaa55); scene.background.setHex(0xffccaa); scene.fog.color.setHex(0xffccaa); } else { sun.intensity = 1.0; sun.color.setHex(0xffffff); scene.background.setHex(0x87CEEB); scene.fog.color.setHex(0x87CEEB); } const hours = Math.floor(time); const minutes = Math.floor((time - hours) * 60); timeValue.textContent = `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`; }
timeSlider.oninput = ev => updateTimeOfDay(parseFloat(ev.target.value)); updateTimeOfDay(12);
function resize() { const w = viewport.clientWidth, h = viewport.clientHeight; if (w === 0 || h === 0) return; renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); updateCameraAspectRatios(); updateViewLayout(); }
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), 0.1);
    if (state.mode === 'editor') {
        if (state.viewMode === '3d') { orbitControls.update(); renderer.setScissorTest(false); renderer.setViewport(0, 0, viewport.clientWidth, viewport.clientHeight); renderer.render(scene, editorCamera); }
        else { views.forEach(v => v.controls.update()); if (state.maximizedView !== null) { renderer.setScissorTest(false); renderer.setViewport(0, 0, viewport.clientWidth, viewport.clientHeight); renderer.render(scene, views[state.maximizedView].camera); } else { renderer.setScissorTest(true); views.forEach((view, i) => { const rect = getViewportRectPx(i); renderer.setViewport(rect.left, rect.bottom, rect.width, rect.height); renderer.setScissor(rect.left, rect.bottom, rect.width, rect.height); renderer.render(scene, view.camera); }); renderer.setScissorTest(false); } }
        if (state.selectedObject) selectionBox.setFromObject(state.selectedObject); selectionBoxes.forEach((box, mesh) => box.setFromObject(mesh));
    } else { updatePlayMode(delta); renderer.setScissorTest(false); renderer.setViewport(0, 0, viewport.clientWidth, viewport.clientHeight); renderer.render(scene, fpsCamera); }
}

try {
    buildSectionsUI(); buildGroupsUI(); buildShapesUI(); resize(); ensureGhostPlank(); pushHistory(); setMode('editor');
    updateMeasureCount(); renderMeasurementsPanel(); updatePropsPanel(); updateProjectNameDisplay();
    const L = 8, spacing = 6;
    for (const x of [-spacing/2, spacing/2]) for (const z of [-spacing/2, spacing/2]) addPlank('4x4', L, new THREE.Vector3(x, L/2, z));
    for (const z of [-spacing/2, spacing/2]) { const m = addPlank('2x4', spacing, new THREE.Vector3(0, L, z)); m.rotation.z = Math.PI / 2; }
    for (const x of [-spacing/2, spacing/2]) { const m = addPlank('2x4', spacing, new THREE.Vector3(x, L, 0)); m.rotation.x = Math.PI / 2; }
    pushHistory(); animate();
    document.getElementById('loading').style.display = 'none'; document.getElementById('app').style.display = 'grid'; resize();
} catch (err) { console.error(err); const ld = document.getElementById('loading'); ld.innerHTML = `<p style="color:#ff6b6b; padding:20px;">${err.message}</p>`; }
