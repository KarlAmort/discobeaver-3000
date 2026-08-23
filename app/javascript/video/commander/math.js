export function normalize(vector) {
   let length = 0;
   for (const value of vector) length += value * value;
   length = Math.sqrt(length) || 1;
   return Float32Array.from(vector, value => value / length);
}

export function dot(a, b) {
   let value = 0;
   for (let index = 0; index < a.length; index++) value += a[index] * b[index];
   return value;
}

export function decodeVector(encoded) {
   const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
   return normalize(Float32Array.from(bytes, value => (value > 127 ? value - 256 : value) / 127));
}

export function encodeVector(vector) {
   const bytes = normalize(vector).map(value => Math.max(-127, Math.min(127, Math.round(value * 127))));
   let binary = "";
   for (const value of bytes) binary += String.fromCharCode(value < 0 ? value + 256 : value);
   return btoa(binary);
}

export function centroid(vectors) {
   if (!vectors.length) return new Float32Array();
   const value = new Float32Array(vectors[0].length);
   for (const vector of vectors) {
      for (let index = 0; index < value.length; index++) value[index] += vector[index];
   }
   return normalize(value);
}

export function furthestPair(tokens) {
   if (tokens.length < 2) return tokens.length ? [ tokens[0], tokens[0], 0 ] : [ null, null, 0 ];
   let pair = [ tokens[0], tokens[1], 1 - dot(tokens[0].vector, tokens[1].vector) ];
   for (let left = 0; left < tokens.length; left++) {
      for (let right = left + 1; right < tokens.length; right++) {
         const distance = 1 - dot(tokens[left].vector, tokens[right].vector);
         if (distance > pair[2]) pair = [ tokens[left], tokens[right], distance ];
      }
   }
   return pair;
}

function subtract(a, b) {
   return Float32Array.from(a, (value, index) => value - b[index]);
}

function reject(vector, axes) {
   const value = Float32Array.from(vector);
   for (const axis of axes) {
      const amount = dot(value, axis);
      for (let index = 0; index < value.length; index++) value[index] -= amount * axis[index];
   }
   return value;
}

function lengthSquared(vector) {
   return dot(vector, vector);
}

function widestResidual(points, origin, axes) {
   let best = null;
   let width = -1;
   for (const point of points) {
      const residual = reject(subtract(point.vector, origin), axes);
      const candidate = lengthSquared(residual);
      if (candidate > width) {
         best = residual;
         width = candidate;
      }
   }
   if (best && width > 1e-9) return normalize(best);
   for (let coordinate = 0; coordinate < origin.length; coordinate++) {
      const unit = new Float32Array(origin.length);
      unit[coordinate] = 1;
      const residual = reject(unit, axes);
      if (lengthSquared(residual) > 1e-9) return normalize(residual);
   }
   return new Float32Array(origin.length);
}

export function projection(tokens, points) {
   const [ negative, positive, distance ] = furthestPair(tokens);
   const origin = negative && positive ? Float32Array.from(negative.vector, (value, index) => (value + positive.vector[index]) / 2) : centroid(points.map(point => point.vector));
   const first = negative && positive && negative !== positive ? normalize(subtract(positive.vector, negative.vector)) : widestResidual(points, origin, []);
   const second = widestResidual(points, origin, [ first ]);
   const third = widestResidual(points, origin, [ first, second ]);
   const axes = [ first, second, third ];
   const projected = points.map(point => ({
      ...point,
      position: axes.map(axis => dot(subtract(point.vector, origin), axis)),
   }));
   return { origin, axes, negative, positive, distance, points: projected };
}

export function poles(terms, axis) {
   if (!terms.length) return { negative: null, positive: null };
   const ranked = terms.map(term => ({ ...term, axis: dot(term.vector, axis) })).sort((left, right) => left.axis - right.axis);
   return { negative: ranked[0], positive: ranked.at(-1) };
}
