function shader(gl, type, source) {
   const value = gl.createShader(type);
   gl.shaderSource(value, source);
   gl.compileShader(value);
   if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
   return value;
}

function program(gl) {
   const value = gl.createProgram();
   gl.attachShader(value, shader(gl, gl.VERTEX_SHADER, `#version 300 es
      in vec3 position;
      in vec3 color;
      uniform float yaw;
      uniform float pitch;
      uniform float distance;
      uniform float aspect;
      uniform bool line;
      out vec3 ink;
      vec3 turn(vec3 p) {
         float cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = sin(pitch);
         p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
         return vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
      }
      void main() {
         vec3 p = turn(position);
         float z = max(.5, distance + p.z);
         gl_Position = vec4(p.x / (z * aspect), p.y / z, 0.0, 1.0);
         gl_PointSize = line ? 1.0 : clamp(16.0 / z, 2.5, 9.0);
         ink = color;
      }`));
   gl.attachShader(value, shader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec3 ink;
      uniform bool line;
      out vec4 pixel;
      void main() {
         if (!line) {
            vec2 q = gl_PointCoord - vec2(.5);
            if (dot(q, q) > .25) discard;
         }
         pixel = vec4(ink, .9);
      }`));
   gl.linkProgram(value);
   if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value));
   return value;
}

function tone(point) {
   if (point.selected) return [ 1, 0.35, 0.22 ];
   if (point.kind === "term") return [ 0.96, 0.78, 0.26 ];
   return [ 0.58, 0.72, 0.82 ];
}

export class ParticleView {
   constructor(canvas, layer) {
      this.canvas = canvas;
      this.layer = layer;
      this.gl = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
      this.context = this.gl ? null : canvas.getContext("2d");
      if (!this.gl && !this.context) throw new Error("canvas unavailable");
      this.program = this.gl ? program(this.gl) : null;
      this.buffer = this.gl ? this.gl.createBuffer() : null;
      this.points = [];
      this.yaw = -0.35;
      this.pitch = 0.18;
      this.distance = 1.7;
      this.frame = 0;
      this.drag = null;
      this.resize = new ResizeObserver(() => this.invalidate());
      this.resize.observe(canvas);
      this.down = event => { this.drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); };
      this.move = event => {
         if (!this.drag) return;
         this.yaw += (event.clientX - this.drag.x) * 0.008;
         this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + (event.clientY - this.drag.y) * 0.008));
         this.drag = { x: event.clientX, y: event.clientY };
         this.invalidate();
      };
      this.up = () => { this.drag = null; };
      this.wheel = event => {
         event.preventDefault();
         this.distance = Math.max(1.1, Math.min(7, this.distance * Math.exp(event.deltaY * 0.001)));
         this.invalidate();
      };
      canvas.addEventListener("pointerdown", this.down);
      canvas.addEventListener("pointermove", this.move);
      canvas.addEventListener("pointerup", this.up);
      canvas.addEventListener("pointercancel", this.up);
      canvas.addEventListener("wheel", this.wheel, { passive: false });
      this.visibility = () => { if (!document.hidden) this.invalidate(); };
      document.addEventListener("visibilitychange", this.visibility);
   }

   set(points) {
      const extent = Math.max(0.01, ...points.flatMap(point => point.position.map(Math.abs)));
      this.points = points.map(point => ({ ...point, position: point.position.map(value => value / extent) }));
      const values = [ -1.15, 0, 0, 1, 0.35, 0.22, 1.15, 0, 0, 1, 0.35, 0.22 ];
      for (const point of this.points) values.push(...point.position, ...tone(point));
      if (this.gl) {
         this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
         this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(values), this.gl.DYNAMIC_DRAW);
      }
      this.invalidate();
   }

   invalidate() {
      if (this.frame || document.hidden) return;
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
   }

   turn(position) {
      const [ x, y, z ] = position;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const rx = cy * x + sy * z, rz = -sy * x + cy * z;
      return [ rx, cp * y - sp * rz, sp * y + cp * rz ];
   }

   screen(position, width, height) {
      const [ x, y, z0 ] = this.turn(position);
      const z = Math.max(0.5, this.distance + z0);
      return [ width / 2 + x / (z * (width / height)) * width / 2, height / 2 - y / z * height / 2, z ];
   }

   labels(width, height) {
      const byId = new Map(this.points.map(point => [ String(point.id), point ]));
      const occupied = [];
      for (const element of this.layer.querySelectorAll("[data-commander-point]")) {
         const point = byId.get(element.dataset.commanderPoint);
         if (!point) { element.hidden = true; continue; }
         const [ left, top, z ] = this.screen(point.position, width, height);
         const priority = point.selected || point.kind === "term";
         const boxWidth = priority ? 150 : 90;
         const boxHeight = point.thumbnail_url ? 68 : 24;
         const box = { left: left - boxWidth / 2, right: left + boxWidth / 2,
            top: top - boxHeight / 2, bottom: top + boxHeight / 2 };
         const outside = left < -40 || left > width + 40 || top < -40 || top > height + 40;
         const collision = occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
         element.hidden = outside || (!priority && collision);
         if (!element.hidden) occupied.push(box);
         element.style.setProperty("--commander-x", `${left}px`);
         element.style.setProperty("--commander-y", `${top}px`);
         element.style.setProperty("--commander-z", String(Math.round(1000 - z * 100)));
      }
   }

   draw() {
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
      const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
         this.canvas.width = pixelWidth;
         this.canvas.height = pixelHeight;
      }
      if (this.gl) this.drawWebGL(width, height, pixelWidth, pixelHeight);
      else this.drawCanvas(width, height, ratio);
      this.labels(width, height);
   }

   drawCanvas(width, height, ratio) {
      const context = this.context;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = "rgba(255, 89, 56, .9)";
      context.lineWidth = 1;
      const left = this.screen([ -1.15, 0, 0 ], width, height);
      const right = this.screen([ 1.15, 0, 0 ], width, height);
      context.beginPath();
      context.moveTo(left[0], left[1]);
      context.lineTo(right[0], right[1]);
      context.stroke();
      for (const point of this.points) {
         const [ left, top, z ] = this.screen(point.position, width, height);
         const color = tone(point).map(value => Math.round(value * 255));
         context.fillStyle = `rgba(${color.join(",")},.9)`;
         context.beginPath();
         context.arc(left, top, Math.max(2.5, Math.min(9, 16 / z)), 0, Math.PI * 2);
         context.fill();
      }
   }

   drawWebGL(width, height, pixelWidth, pixelHeight) {
      const gl = this.gl;
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
      const position = gl.getAttribLocation(this.program, "position");
      const color = gl.getAttribLocation(this.program, "color");
      gl.enableVertexAttribArray(position);
      gl.enableVertexAttribArray(color);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(color, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
      gl.uniform1f(gl.getUniformLocation(this.program, "yaw"), this.yaw);
      gl.uniform1f(gl.getUniformLocation(this.program, "pitch"), this.pitch);
      gl.uniform1f(gl.getUniformLocation(this.program, "distance"), this.distance);
      gl.uniform1f(gl.getUniformLocation(this.program, "aspect"), width / height);
      gl.uniform1i(gl.getUniformLocation(this.program, "line"), 1);
      gl.drawArrays(gl.LINES, 0, 2);
      gl.uniform1i(gl.getUniformLocation(this.program, "line"), 0);
      gl.drawArrays(gl.POINTS, 2, this.points.length);
   }

   destroy() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.resize.disconnect();
      document.removeEventListener("visibilitychange", this.visibility);
      this.canvas.removeEventListener("pointerdown", this.down);
      this.canvas.removeEventListener("pointermove", this.move);
      this.canvas.removeEventListener("pointerup", this.up);
      this.canvas.removeEventListener("pointercancel", this.up);
      this.canvas.removeEventListener("wheel", this.wheel);
   }
}
