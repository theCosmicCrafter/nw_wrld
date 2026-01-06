/*
@nwWrld name: LowEarthPoint
@nwWrld category: 3D
@nwWrld imports: BaseThreeJsModule, THREE
*/

const sampleN = (arr, n) => {
  if (!arr || arr.length === 0) return [];
  const copy = arr.slice();
  const out = [];
  const count = Math.max(0, Math.min(copy.length, n));
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return out;
};

class LowEarthPointModule extends BaseThreeJsModule {
  static methods = [
    {
      name: "primary",
      executeOnLoad: false,
      options: [
        {
          name: "duration",
          defaultVal: 0,
          type: "number",
          description: "Duration for primary method animations",
        },
      ],
    },
  ];

  constructor(container) {
    super(container);
    if (!THREE) return;

    this.name = LowEarthPointModule.name;
    this.customGroup = new THREE.Group();
    this.customObjects = [];
    this.points = [];
    this.redPoints = [];
    this.linesGroup = new THREE.Group();
    this.redLinesGroup = new THREE.Group();
    this.customGroup.add(this.linesGroup);
    this.customGroup.add(this.redLinesGroup);
    this.pointCloud = null;
    this.redPointCloud = null;
    this.primary = this.primary.bind(this);
    this.setCustomAnimate(this.animateLoop.bind(this));
    this.init();
  }

  init() {
    if (this.destroyed) return;
    this.createPoints();
    this.createRedPoints();
    this.createLines();
    this.createRedLines();
    this.setModel(this.customGroup);
  }

  createPoints() {
    if (this.destroyed) return;

    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.05,
    });
    const positions = [];

    const count = 500;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 10 - 5;
      const y = Math.random() * 10 - 5;
      const z = Math.random() * 10 - 5;
      positions.push(x, y, z);
      this.points.push(new THREE.Vector3(x, y, z));
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    this.pointCloud = new THREE.Points(geometry, material);
    this.customGroup.add(this.pointCloud);
    this.customObjects.push(this.pointCloud);
  }

  createRedPoints() {
    if (this.destroyed) return;

    const redGeometry = new THREE.BufferGeometry();
    const redMaterial = new THREE.PointsMaterial({
      color: 0xff0000,
      size: 0.045,
    });
    const redPositions = [];

    const count = 250;
    for (let i = 0; i < count; i++) {
      const x = (Math.random() * 10 - 5) * 0.5;
      const y = (Math.random() * 10 - 5) * 0.5;
      const z = (Math.random() * 10 - 5) * 0.5;
      redPositions.push(x, y, z);
      this.redPoints.push(new THREE.Vector3(x, y, z));
    }

    redGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(redPositions, 3)
    );

    this.redPointCloud = new THREE.Points(redGeometry, redMaterial);
    this.customGroup.add(this.redPointCloud);
    this.customObjects.push(this.redPointCloud);
  }

  createLines() {
    if (this.destroyed) return;

    this.linesGroup.clear();
    const halfPointIndex = Math.floor(this.points.length / 3);
    for (let i = 0; i < halfPointIndex; i++) {
      for (let j = i + 1; j < halfPointIndex; j++) {
        const start = this.points[i];
        const end = this.points[j];
        const midZ = (start.z + end.z) / 2;
        const mid = new THREE.Vector3(
          (start.x + end.x) / 2,
          (start.y + end.y) / 2,
          midZ
        );
        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const points = curve.getPoints(5);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: 0xffffff,
          linewidth: 1,
          opacity: 0.1,
          transparent: true,
        });
        const curveObject = new THREE.Line(geometry, material);
        this.linesGroup.add(curveObject);
      }
    }
  }

  createRedLines() {
    if (this.destroyed) return;

    this.redLinesGroup.clear();
    const halfRedPointIndex = Math.floor(this.redPoints.length / 2);
    for (let i = 0; i < halfRedPointIndex; i++) {
      for (let j = i + 1; j < halfRedPointIndex; j++) {
        const start = this.redPoints[i];
        const end = this.redPoints[j];
        const midZ = (start.z + end.z) / 2;
        const mid = new THREE.Vector3(
          (start.x + end.x) / 2,
          (start.y + end.y) / 2,
          midZ * 2
        );
        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const points = curve.getPoints(5);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: 0xff0000,
          linewidth: 1,
          opacity: 0.15,
          transparent: true,
        });
        const curveObject = new THREE.Line(geometry, material);
        this.redLinesGroup.add(curveObject);
      }
    }
  }

  animateLoop() {
    if (this.destroyed) return;

    if (this.pointCloud) {
      this.pointCloud.rotation.x += 0.0005 * this.cameraSettings.cameraSpeed;
      this.pointCloud.rotation.y += 0.0005 * this.cameraSettings.cameraSpeed;
    }

    if (this.redPointCloud) {
      this.redPointCloud.rotation.x += 0.0003 * this.cameraSettings.cameraSpeed;
      this.redPointCloud.rotation.y += 0.0003 * this.cameraSettings.cameraSpeed;
    }

    this.linesGroup.children.forEach((line) => {
      line.rotation.x += 0.0003 * this.cameraSettings.cameraSpeed;
      line.rotation.y += 0.0003 * this.cameraSettings.cameraSpeed;
    });

    this.redLinesGroup.children.forEach((line) => {
      line.rotation.x += 0.0003 * this.cameraSettings.cameraSpeed;
      line.rotation.y += 0.0003 * this.cameraSettings.cameraSpeed;
    });
  }

  primary({ duration } = {}) {
    if (this.destroyed) return;

    const seconds = Number(duration) || 0;
    const millis = seconds > 0 ? seconds * 1000 : 500;
    const selected = sampleN(this.points, 5);
    const spheres = [];

    selected.forEach((point) => {
      const geometry = new THREE.SphereGeometry(0.09, 8, 8);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(point);
      this.scene.add(mesh);
      spheres.push(mesh);
    });

    setTimeout(() => {
      spheres.forEach((mesh) => {
        this?.scene?.remove(mesh);
        try {
          mesh.geometry && mesh.geometry.dispose();
          mesh.material && mesh.material.dispose();
        } catch {}
      });
    }, millis);
  }

  destroy() {
    if (this.destroyed) return;

    this.customObjects.forEach((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat) => mat.dispose());
        } else {
          obj.material.dispose();
        }
      }
      this.scene.remove(obj);
    });
    this.customObjects = [];
    this.linesGroup.clear();
    this.redLinesGroup.clear();
    super.destroy();
  }
}

export default LowEarthPointModule;
