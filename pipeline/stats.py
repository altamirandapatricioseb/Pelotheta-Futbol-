"""Estadística en Python puro para los modelos (valor de mercado, alternativas y predictor).

Sin numpy ni scikit-learn a propósito: son pocas filas (un plantel, una liga) y cada fórmula
tiene que poder explicarse en una entrevista.
"""

from __future__ import annotations

import math
import random
from collections.abc import Sequence
from dataclasses import dataclass

Matrix = list[list[float]]
Vector = list[float]

# --- Álgebra mínima -------------------------------------------------------------------------


def transpose(a: Matrix) -> Matrix:
    return [list(col) for col in zip(*a, strict=True)]


def matmul(a: Matrix, b: Matrix) -> Matrix:
    bt = transpose(b)
    return [[sum(x * y for x, y in zip(row, col, strict=True)) for col in bt] for row in a]


def inverse(a: Matrix) -> Matrix:
    """Inversa por Gauss-Jordan con pivoteo parcial. ValueError si la matriz es singular."""
    n = len(a)
    m = [[*row, *(1.0 if i == j else 0.0 for j in range(n))] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-12:
            raise ValueError("matriz singular: variables colineales o pocas filas")
        m[col], m[pivot] = m[pivot], m[col]
        p = m[col][col]
        m[col] = [v / p for v in m[col]]
        for r in range(n):
            if r != col and m[r][col] != 0:
                f = m[r][col]
                m[r] = [v - f * w for v, w in zip(m[r], m[col], strict=True)]
    return [row[n:] for row in m]


def dist(a: Sequence[float], b: Sequence[float]) -> float:
    """Distancia euclídea."""
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=True)))


# --- Distribuciones ------------------------------------------------------


def poisson_pmf(k: int, lam: float) -> float:
    """P(X = k) con X ~ Poisson(λ)."""
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(k * math.log(lam) - lam - math.lgamma(k + 1))


def _betacf(a: float, b: float, x: float) -> float:
    # Fracción continua de la beta incompleta (método de Lentz).
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1, a - 1
    c = 1.0
    d = 1 - qab * x / qap
    d = 1 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        for aa in (
            m * (b - m) * x / ((qam + m2) * (a + m2)),
            -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)),
        ):
            d = 1 + aa * d
            d = 1 / (d if abs(d) > tiny else tiny)
            c = 1 + aa / c
            c = c if abs(c) > tiny else tiny
            h *= d * c
        if abs(d * c - 1) < 1e-14:
            break
    return h


def beta_inc(a: float, b: float, x: float) -> float:
    """Beta incompleta regularizada I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(
        math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    )
    if x < (a + 1) / (a + b + 2):
        return front * _betacf(a, b, x) / a
    return 1 - front * _betacf(b, a, 1 - x) / b


def t_two_sided_p(t: float, df: float) -> float:
    """p-valor de dos colas de la t de Student."""
    return beta_inc(df / 2, 0.5, df / (df + t * t))


def t_quantile(q: float, df: float) -> float:
    """Cuantil t_q (q > 0,5) con df grados de libertad, por bisección sobre la acumulada."""
    target = 2 * (1 - q)  # p de dos colas que deja q a la izquierda
    lo, hi = 0.0, 1000.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if t_two_sided_p(mid, df) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def gamma_inc_upper(a: float, x: float) -> float:
    """Gamma incompleta superior regularizada Q(a, x)."""
    if x <= 0:
        return 1.0
    gln = math.lgamma(a)
    if x < a + 1:  # serie
        term = total = 1 / a
        ap = a
        for _ in range(500):
            ap += 1
            term *= x / ap
            total += term
            if abs(term) < abs(total) * 1e-15:
                break
        return 1 - total * math.exp(-x + a * math.log(x) - gln)
    tiny = 1e-300  # fracción continua (Lentz)
    b = x + 1 - a
    c, d = 1 / tiny, 1 / b
    h = d
    for i in range(1, 500):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        d = 1 / (d if abs(d) > tiny else tiny)
        c = b + an / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        if abs(d * c - 1) < 1e-15:
            break
    return math.exp(-x + a * math.log(x) - gln) * h


def chi2_sf(x: float, df: float) -> float:
    """P(χ²_df > x): p-valor de las pruebas de bondad de ajuste e independencia."""
    return gamma_inc_upper(df / 2, x / 2)


# --- Descriptiva e inferencia ----------------------------------------


def mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs)


def variance(xs: Sequence[float]) -> float:
    """Varianza muestral (n − 1), el estimador insesgado."""
    m = mean(xs)
    return sum((x - m) ** 2 for x in xs) / (len(xs) - 1)


def mean_ci(xs: Sequence[float], level: float = 0.95) -> tuple[float, float, float]:
    """(media, mínimo, máximo) del intervalo de confianza t para la media."""
    n = len(xs)
    m = mean(xs)
    half = t_quantile(1 - (1 - level) / 2, n - 1) * math.sqrt(variance(xs) / n)
    return m, m - half, m + half


def pearson(xs: Sequence[float], ys: Sequence[float]) -> float:
    """Coeficiente de correlación lineal r. 0 si alguna variable es constante."""
    mx, my = mean(xs), mean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else 0.0


def zscores(columns: Sequence[Sequence[float]]) -> list[Vector]:
    """Estandariza cada columna: z = (x − media) / desvío (cambio de variable)."""
    out = []
    for col in columns:
        m = mean(col)
        sd = math.sqrt(variance(col)) if len(col) > 1 else 0.0
        out.append([(x - m) / sd if sd > 0 else 0.0 for x in col])
    return out


def chi2_gof(
    observed: Sequence[float], expected: Sequence[float], estimated: int = 0
) -> tuple[float, int, float]:
    """Bondad de ajuste χ²: (estadístico, grados de libertad, p-valor).

    `estimated` = parámetros estimados con los mismos datos (λ de la Poisson: 1).
    """
    stat = sum((o - e) ** 2 / e for o, e in zip(observed, expected, strict=True) if e > 0)
    df = max(1, len(observed) - 1 - estimated)
    return stat, df, chi2_sf(stat, df)


def chi2_independence(
    table: Sequence[Sequence[float]],
) -> tuple[float, int, float, list[list[float]]]:
    """Independencia en una tabla de contingencia: (χ², gl, p, esperados)."""
    total = sum(sum(r) for r in table)
    rows = [sum(r) for r in table]
    cols = [sum(c) for c in zip(*table, strict=True)]
    expected = [[r * c / total for c in cols] for r in rows]
    stat = sum(
        (o - e) ** 2 / e
        for ro, re in zip(table, expected, strict=True)
        for o, e in zip(ro, re, strict=True)
        if e > 0
    )
    df = (len(rows) - 1) * (len(cols) - 1)
    return stat, df, chi2_sf(stat, df), expected


# --- Regresión lineal por mínimos cuadrados --------------------------------------


@dataclass(frozen=True)
class Coef:
    name: str
    value: float
    std_err: float
    t: float
    p: float
    low: float
    high: float


@dataclass(frozen=True)
class OLS:
    coefs: list[Coef]
    r2: float
    adj_r2: float
    rmse: float
    n: int
    s2: float
    xtx_inv: Matrix
    t_crit: float
    fitted: list[float]
    residuals: list[float]

    def predict(self, x: Sequence[float]) -> tuple[float, float, float]:
        """(ŷ, mínimo, máximo) del intervalo de predicción del 95 % para una fila nueva."""
        row = [1.0, *x]
        y = sum(c.value * v for c, v in zip(self.coefs, row, strict=True))
        leverage = matmul([row], matmul(self.xtx_inv, [[v] for v in row]))[0][0]
        half = self.t_crit * math.sqrt(self.s2 * (1 + leverage))
        return y, y - half, y + half


def ols(
    names: Sequence[str], rows: Sequence[Sequence[float]], y: Sequence[float], level: float = 0.95
) -> OLS:
    """β = (XᵀX)⁻¹Xᵀy con intercepto, errores estándar, t, p e intervalos de confianza."""
    x = [[1.0, *r] for r in rows]
    n, p = len(x), len(x[0])
    if n <= p:
        raise ValueError(f"hacen falta más de {p} filas para {p} coeficientes (hay {n})")
    xt = transpose(x)
    xtx_inv = inverse(matmul(xt, x))
    beta = [b[0] for b in matmul(xtx_inv, matmul(xt, [[v] for v in y]))]
    fitted = [sum(b * v for b, v in zip(beta, r, strict=True)) for r in x]
    residuals = [yi - fi for yi, fi in zip(y, fitted, strict=True)]
    sse = sum(e * e for e in residuals)
    my = mean(y)
    sst = sum((v - my) ** 2 for v in y)
    df = n - p
    s2 = sse / df
    t_crit = t_quantile(1 - (1 - level) / 2, df)
    coefs = []
    for i, name in enumerate(["intercepto", *names]):
        se = math.sqrt(max(s2 * xtx_inv[i][i], 0.0))
        t = beta[i] / se if se > 0 else 0.0
        coefs.append(
            Coef(name, beta[i], se, t, t_two_sided_p(t, df), beta[i] - t_crit * se, beta[i] + t_crit * se)
        )
    r2 = 1 - sse / sst if sst > 0 else 0.0
    return OLS(
        coefs=coefs,
        r2=r2,
        adj_r2=1 - (1 - r2) * (n - 1) / df,
        rmse=math.sqrt(sse / n),
        n=n,
        s2=s2,
        xtx_inv=xtx_inv,
        t_crit=t_crit,
        fitted=fitted,
        residuals=residuals,
    )


# --- K-means y PCA (estilos de juego) -------------------------------------------------------


def _assign(points: Sequence[Vector], centers: Sequence[Vector]) -> list[int]:
    return [min(range(len(centers)), key=lambda c: dist(p, centers[c])) for p in points]


def kmeans(
    points: Sequence[Vector], k: int, seed: int = 7, n_init: int = 10
) -> tuple[list[int], list[Vector], float]:
    """K-means con arranque k-means++ y semilla fija: (etiquetas, centros, inercia).

    Corre `n_init` arranques y se queda con el de menor inercia (suma de distancias² al centro).
    """
    rng = random.Random(seed)  # noqa: S311 (no es criptografía: semilla fija para que sea reproducible)
    best: tuple[list[int], list[Vector], float] | None = None
    for _ in range(n_init):
        centers = [list(rng.choice(points))]
        while len(centers) < k:
            d2 = [min(dist(p, c) ** 2 for c in centers) for p in points]
            pick = rng.uniform(0, sum(d2))
            acc = 0.0
            chosen = points[-1]
            for p, w in zip(points, d2, strict=True):
                acc += w
                if acc >= pick and w > 0:
                    chosen = p
                    break
            centers.append(list(chosen))
        labels: list[int] = []
        for _ in range(100):
            new = _assign(points, centers)
            if new == labels:
                break
            labels = new
            for c in range(k):
                members = [p for p, lab in zip(points, labels, strict=True) if lab == c]
                if members:
                    centers[c] = [mean(col) for col in zip(*members, strict=True)]
        inertia = sum(dist(p, centers[lab]) ** 2 for p, lab in zip(points, labels, strict=True))
        if best is None or inertia < best[2]:
            best = (labels, centers, inertia)
    if best is None:
        raise ValueError("n_init debe ser al menos 1")
    return best


def silhouette(points: Sequence[Vector], labels: Sequence[int]) -> float:
    """Silueta media (−1 a 1): qué tan separado está cada punto de los otros grupos."""
    if len(set(labels)) < 2:
        return 0.0
    scores = []
    for i, p in enumerate(points):
        by_group: dict[int, list[float]] = {}
        for j, q in enumerate(points):
            if i != j:
                by_group.setdefault(labels[j], []).append(dist(p, q))
        own = by_group.get(labels[i])
        if not own:
            scores.append(0.0)
            continue
        a = mean(own)
        b = min(mean(v) for g, v in by_group.items() if g != labels[i])
        scores.append((b - a) / max(a, b) if max(a, b) > 0 else 0.0)
    return mean(scores)


def pca2(points: Sequence[Vector], seed: int = 7) -> tuple[list[tuple[float, float]], tuple[float, float]]:
    """Proyección en las 2 componentes principales (iteración de potencias con deflación).

    Devuelve las coordenadas y la proporción de la varianza total que explica cada eje.
    """
    n, d = len(points), len(points[0])
    means = [mean(col) for col in zip(*points, strict=True)]
    centered = [[v - m for v, m in zip(p, means, strict=True)] for p in points]
    cov = [[sum(r[i] * r[j] for r in centered) / (n - 1) for j in range(d)] for i in range(d)]
    total = sum(cov[i][i] for i in range(d)) or 1.0
    rng = random.Random(seed)  # noqa: S311
    comps: list[Vector] = []
    shares: list[float] = []
    for _ in range(2):
        v = [rng.uniform(-1, 1) for _ in range(d)]
        eig = 0.0
        for _ in range(500):
            w = [sum(cov[i][j] * v[j] for j in range(d)) for i in range(d)]
            eig = math.sqrt(sum(x * x for x in w))
            if eig == 0:
                break
            v = [x / eig for x in w]
        comps.append(v)
        shares.append(eig / total)
        cov = [[cov[i][j] - eig * v[i] * v[j] for j in range(d)] for i in range(d)]

    def project(r: Vector, c: Vector) -> float:
        return sum(a * b for a, b in zip(r, c, strict=True))

    coords = [(project(r, comps[0]), project(r, comps[1])) for r in centered]
    return coords, (shares[0], shares[1])
