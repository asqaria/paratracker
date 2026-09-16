import { breakOffGrid, forEachSegment } from './grid.js';

export interface SmoothingOptions {
  /** Размер окна, отсчётов. */
  window: number;
  /** Степень полинома. */
  order: number;
  /** Шаг сетки: через разрыв сетки не сглаживаем. */
  intervalS: number;
}

const coefficientCache = new Map<string, Float64Array>();

/** Гаусс с выбором ведущего элемента; система маленькая — (order + 1)². */
function solve(matrix: Float64Array[], rhs: Float64Array): Float64Array {
  const n = rhs.length;
  const a = matrix.map((row) => Float64Array.from(row));
  const b = Float64Array.from(rhs);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot] ?? new Float64Array(n), a[col] ?? new Float64Array(n)];
    [b[col], b[pivot]] = [b[pivot] ?? 0, b[col] ?? 0];

    const pivotRow = a[col] ?? new Float64Array(n);
    for (let row = col + 1; row < n; row++) {
      const current = a[row] ?? new Float64Array(n);
      const factor = (current[col] ?? 0) / (pivotRow[col] ?? 1);
      for (let k = col; k < n; k++) current[k] = (current[k] ?? 0) - factor * (pivotRow[k] ?? 0);
      b[row] = (b[row] ?? 0) - factor * (b[col] ?? 0);
    }
  }

  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    const current = a[row] ?? new Float64Array(n);
    let sum = b[row] ?? 0;
    for (let k = row + 1; k < n; k++) sum -= (current[k] ?? 0) * (x[k] ?? 0);
    x[row] = sum / (current[row] ?? 1);
  }
  return x;
}

/**
 * Коэффициенты Савицкого–Голея: полином степени order по методу наименьших квадратов
 * на окне size, значение в позиции position (0…size−1). Для центра — классическая
 * таблица, для краёв — несимметричная подгонка, поэтому края тоже сглажены без NaN.
 * Окно короче order + 1 — степень понижается.
 */
export function savitzkyGolayCoefficients(size: number, order: number, position: number): Float64Array {
  const key = `${size}:${order}:${position}`;
  const cached = coefficientCache.get(key);
  if (cached) return cached;

  const degree = Math.min(order, size - 1);
  const terms = degree + 1;
  const center = (size - 1) / 2;

  // Нормальные уравнения (AᵀA)·z = a(position), где A[k][p] = (k − center)^p.
  const normal = Array.from({ length: terms }, () => new Float64Array(terms));
  for (let k = 0; k < size; k++) {
    const x = k - center;
    for (let p = 0; p < terms; p++) {
      const row = normal[p] ?? new Float64Array(terms);
      for (let q = 0; q < terms; q++) row[q] = (row[q] ?? 0) + x ** (p + q);
    }
  }
  const z = solve(normal, Float64Array.from({ length: terms }, (_, p) => (position - center) ** p));

  const coefficients = new Float64Array(size);
  for (let k = 0; k < size; k++) {
    const x = k - center;
    let c = 0;
    for (let p = 0; p < terms; p++) c += (z[p] ?? 0) * x ** p;
    coefficients[k] = c;
  }

  coefficientCache.set(key, coefficients);
  return coefficients;
}

function smoothRun(values: Float64Array, out: Float64Array, from: number, to: number, options: SmoothingOptions): void {
  const size = Math.min(options.window, to - from + 1);
  const half = (size - 1) >> 1;
  for (let i = from; i <= to; i++) {
    const windowStart = Math.min(Math.max(i - half, from), to - size + 1);
    const coefficients = savitzkyGolayCoefficients(size, options.order, i - windowStart);
    let sum = 0;
    for (let k = 0; k < size; k++) sum += (coefficients[k] ?? 0) * (values[windowStart + k] ?? 0);
    out[i] = sum;
  }
}

/**
 * ТЗ §5.2 шаг 3: сглаживание высоты. Участки сглаживаются независимо: разрыв сетки
 * или NaN в значениях разделяют их; NaN остаётся NaN. Вход не меняется.
 */
export function savitzkyGolay(values: Float64Array, t: Float64Array, options: SmoothingOptions): Float64Array {
  const out = new Float64Array(values.length).fill(Number.NaN);

  forEachSegment(t, breakOffGrid(options.intervalS), (start, end) => {
    let runStart = start;
    for (let i = start; i <= end + 1; i++) {
      if (i > end || Number.isNaN(values[i] ?? Number.NaN)) {
        if (i > runStart) smoothRun(values, out, runStart, i - 1, options);
        runStart = i + 1;
      }
    }
  });

  return out;
}
