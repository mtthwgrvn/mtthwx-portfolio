/* Three.js starfield + drifting particle field for the landing hero */
(function () {
  var canvas = document.getElementById('webgl');
  if (!canvas || typeof THREE === 'undefined') return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 6;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // --- particle starfield ---
  var isMobile = window.innerWidth < 768;
  var COUNT = isMobile ? 900 : 2600;
  var positions = new Float32Array(COUNT * 3);
  var speeds = new Float32Array(COUNT);
  for (var i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 22;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
    speeds[i] = 0.2 + Math.random() * 0.8;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  var mat = new THREE.PointsMaterial({
    color: 0xaebcff,
    size: 0.022,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  var stars = new THREE.Points(geo, mat);
  scene.add(stars);

  // --- wireframe "orbit" ring ---
  var ringGeo = new THREE.TorusGeometry(2.6, 0.002, 8, 220);
  var ringMat = new THREE.MeshBasicMaterial({ color: 0x6e8bff, transparent: true, opacity: 0.35 });
  var ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2.4;
  ring.position.set(2.4, 0.4, 0);
  scene.add(ring);

  var ring2 = ring.clone();
  ring2.scale.setScalar(1.45);
  ring2.material = new THREE.MeshBasicMaterial({ color: 0x6e8bff, transparent: true, opacity: 0.16 });
  scene.add(ring2);

  // --- icosahedron core ---
  var coreGeo = new THREE.IcosahedronGeometry(0.55, 1);
  var coreMat = new THREE.MeshBasicMaterial({ color: 0x6e8bff, wireframe: true, transparent: true, opacity: 0.5 });
  var core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(2.4, 0.4, 0);
  scene.add(core);

  // Camera is fixed — no mouse-parallax tracking (it was a motion-sickness trigger).
  camera.lookAt(0, 0, 0);

  function resize() {
    var w = canvas.clientWidth || window.innerWidth;
    var h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (reduced) renderer.render(scene, camera); // keep the static frame correct on resize
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // Reduced motion: render a single static frame, no animation loop.
  if (reduced) {
    renderer.render(scene, camera);
    return;
  }

  var clock = new THREE.Clock();
  var running = true;

  // pause when hero is off-screen
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      running = entries[0].isIntersecting;
    }).observe(canvas);
  }

  function tick() {
    requestAnimationFrame(tick);
    if (!running) return;
    var t = clock.getElapsedTime();

    var pos = geo.attributes.position.array;
    for (var i = 0; i < COUNT; i++) {
      pos[i * 3] -= speeds[i] * 0.0035;
      if (pos[i * 3] < -11) pos[i * 3] = 11;
    }
    geo.attributes.position.needsUpdate = true;

    ring.rotation.z = t * 0.12;
    ring2.rotation.z = -t * 0.07;
    core.rotation.x = t * 0.2;
    core.rotation.y = t * 0.26;

    renderer.render(scene, camera);
  }
  tick();
})();
