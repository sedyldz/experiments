// One Euro Filter (Casiez, Roussel & Vogel, 2012): the standard low-latency
// adaptive smoothing filter for noisy tracking signals like hand landmarks.
// It smooths hard when a value is nearly still (killing jitter) and backs
// off automatically during fast motion (avoiding lag), which a fixed-alpha
// exponential smoother can't do for both cases at once.
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null) {
      this.tPrev = t;
      this.xPrev = x;
      return x;
    }
    const dt = Math.max(t - this.tPrev, 1e-6);
    this.tPrev = t;

    const dx = (x - (this.xPrev ?? x)) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * (this.xPrev ?? x);
    this.xPrev = xHat;
    return xHat;
  }
}

export interface LandmarkFilter {
  x: OneEuroFilter;
  y: OneEuroFilter;
  z: OneEuroFilter;
}

export function createLandmarkFilters(count: number): LandmarkFilter[] {
  return Array.from({ length: count }, () => ({
    x: new OneEuroFilter(0.5, 1.2, 1),
    y: new OneEuroFilter(0.5, 1.2, 1),
    z: new OneEuroFilter(0.5, 1.2, 1),
  }));
}
