// Dense linear solvers for Modified Nodal Analysis systems.
// Circuits built interactively are small (tens of unknowns), so dense
// Gaussian elimination with partial pivoting is fast and robust.

export class SingularMatrixError extends Error {
  constructor(public row: number) {
    super(`Singular matrix at row ${row}`);
  }
}

const PIVOT_EPS = 1e-15;

/** Solve A·x = b in place (A is row-major n×n). Returns x. Throws SingularMatrixError. */
export function solveReal(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const a = A.slice();
  const x = b.slice();
  const perm = new Int32Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;

  for (let k = 0; k < n; k++) {
    // partial pivot
    let piv = k;
    let max = Math.abs(a[k * n + k]);
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(a[r * n + k]);
      if (v > max) {
        max = v;
        piv = r;
      }
    }
    if (max < PIVOT_EPS) throw new SingularMatrixError(k); // unknown k is undetermined
    if (piv !== k) {
      for (let c = 0; c < n; c++) {
        const t = a[k * n + c];
        a[k * n + c] = a[piv * n + c];
        a[piv * n + c] = t;
      }
      const tb = x[k];
      x[k] = x[piv];
      x[piv] = tb;
      const tp = perm[k];
      perm[k] = perm[piv];
      perm[piv] = tp;
    }
    const pkk = a[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const f = a[r * n + k] / pkk;
      if (f === 0) continue;
      a[r * n + k] = 0;
      for (let c = k + 1; c < n; c++) a[r * n + c] -= f * a[k * n + c];
      x[r] -= f * x[k];
    }
  }
  // back substitution
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= a[r * n + c] * x[c];
    x[r] = s / a[r * n + r];
  }
  return x;
}

/** Complex solve with separate real/imag arrays. Returns [xr, xi]. */
export function solveComplex(
  Ar: Float64Array,
  Ai: Float64Array,
  br: Float64Array,
  bi: Float64Array,
  n: number,
): [Float64Array, Float64Array] {
  const ar = Ar.slice();
  const ai = Ai.slice();
  const xr = br.slice();
  const xi = bi.slice();
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.hypot(ar[k * n + k], ai[k * n + k]);
    for (let r = k + 1; r < n; r++) {
      const v = Math.hypot(ar[r * n + k], ai[r * n + k]);
      if (v > max) {
        max = v;
        piv = r;
      }
    }
    if (max < PIVOT_EPS) throw new SingularMatrixError(k);
    if (piv !== k) {
      for (let c = 0; c < n; c++) {
        let t = ar[k * n + c];
        ar[k * n + c] = ar[piv * n + c];
        ar[piv * n + c] = t;
        t = ai[k * n + c];
        ai[k * n + c] = ai[piv * n + c];
        ai[piv * n + c] = t;
      }
      let t = xr[k];
      xr[k] = xr[piv];
      xr[piv] = t;
      t = xi[k];
      xi[k] = xi[piv];
      xi[piv] = t;
    }
    const pr = ar[k * n + k];
    const pi = ai[k * n + k];
    const den = pr * pr + pi * pi;
    for (let r = k + 1; r < n; r++) {
      const rr = ar[r * n + k];
      const ri = ai[r * n + k];
      if (rr === 0 && ri === 0) continue;
      // f = a[r][k] / a[k][k]
      const fr = (rr * pr + ri * pi) / den;
      const fi = (ri * pr - rr * pi) / den;
      for (let c = k; c < n; c++) {
        const kr = ar[k * n + c];
        const ki = ai[k * n + c];
        ar[r * n + c] -= fr * kr - fi * ki;
        ai[r * n + c] -= fr * ki + fi * kr;
      }
      const kr = xr[k];
      const ki = xi[k];
      xr[r] -= fr * kr - fi * ki;
      xi[r] -= fr * ki + fi * kr;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sr = xr[r];
    let si = xi[r];
    for (let c = r + 1; c < n; c++) {
      const cr = ar[r * n + c];
      const ci = ai[r * n + c];
      sr -= cr * xr[c] - ci * xi[c];
      si -= cr * xi[c] + ci * xr[c];
    }
    const pr = ar[r * n + r];
    const pi = ai[r * n + r];
    const den = pr * pr + pi * pi;
    xr[r] = (sr * pr + si * pi) / den;
    xi[r] = (si * pr - sr * pi) / den;
  }
  return [xr, xi];
}
