// Tyre marks left on the road while a car is skidding.
// Drawn as many short dark strips; when the supply runs out the oldest are reused.
import * as THREE from 'three';

export class SkidMarks {
  constructor(capacity = 4000) {
    const geo = new THREE.PlaneGeometry(0.34, 1);
    geo.rotateX(-Math.PI / 2);                         // lie flat, length along z
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.capacity = capacity;
    this.next = 0;
    this.last = new Map();                             // car -> previous position of each rear wheel
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0); this._tilt = new THREE.Quaternion();
  }

  // Call once per physics step for each car
  update(car) {
    if (!car.skidding) { this.last.delete(car); return; }
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const now = car.rearWheels.map(([wx, wz]) => ({ x: car.x + fz * wx + fx * wz, z: car.z - fx * wx + fz * wz }));
    const before = this.last.get(car);
    if (!before) { this.last.set(car, now); return; }
    now.forEach((p, k) => {
      const dx = p.x - before[k].x, dz = p.z - before[k].z, len = Math.hypot(dx, dz);
      if (len < 0.35) { now[k] = before[k]; return; }   // wait until the wheel has moved a bit
      const mx = (p.x + before[k].x) / 2, mz = (p.z + before[k].z) / 2, t = car.track;
      this._p.set(mx, (t.heightAt ? t.heightAt(mx, mz) : 0) + 0.03, mz);
      this._q.setFromAxisAngle(this._up, Math.atan2(dx, dz));
      if (t.normalAt) this._q.premultiply(this._tilt.setFromUnitVectors(this._up, t.normalAt(mx, mz)));   // lie on sloping ground
      this._s.set(1, 1, len + 0.05);
      this.mesh.setMatrixAt(this.next, this._m.compose(this._p, this._q, this._s));
      this.next = (this.next + 1) % this.capacity;
      this.mesh.count = Math.min(this.capacity, this.mesh.count + 1);
      this.mesh.instanceMatrix.needsUpdate = true;
    });
    this.last.set(car, now);
  }

  clear() { this.mesh.count = 0; this.next = 0; this.last.clear(); }
}
