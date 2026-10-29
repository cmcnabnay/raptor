// Stage 1: ideal choked-throat / isentropic nozzle model.
// Pure functions, SI units, no DOM. Reused by later stages (supply, turbines, coupling).
(function (root) {
  const G0 = 9.80665;

  // A/A* as a function of Mach number (isentropic, perfect gas)
  function areaRatio(M, g) {
    const k = (g + 1) / (2 * (g - 1));
    return (1 / M) * Math.pow((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M), k);
  }

  // Supersonic root of areaRatio(M) = ar. A/A* increases monotonically for M > 1.
  function solveExitMach(ar, g) {
    let lo = 1, hi = 100;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (areaRatio(mid, g) < ar) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // Qualitative flow-regime label for the nozzle exit. Return a short string
  // (e.g. "over-expanded") or null for no label. The UI shows it next to the thrust.
  function nozzleFlowRegime(pe, pa) {
    if(pa==0)
      return "Under Expanded"
    if(pe/pa > 1+.05)
      return "Under Expanded"
    else if(pe/pa < 1-.05)
      if(pe/pa < 0.4)
        return "Over Expanded, likely separation"
      else  
        return "Over Expanded"
    else if (pe/pa < 1.05 && pe/pa > 0.95)
      return "Matched"
    return null;
  }

  function computeNozzle(p) {
    const { Pc, Tc, gamma: g, R, At, areaRatio: ar, pa } = p;
    const Ae = ar * At;

    const mdot = At * Pc * Math.sqrt(g / (R * Tc)) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
    const Me = solveExitMach(ar, g);
    const pe = Pc * Math.pow(1 + ((g - 1) / 2) * Me * Me, -g / (g - 1));
    const ve = Math.sqrt(((2 * g) / (g - 1)) * R * Tc * (1 - Math.pow(pe / Pc, (g - 1) / g)));

    const Fmomentum = mdot * ve;
    const Fpressure = (pe - pa) * Ae;
    const F = Fmomentum + Fpressure;
    const Fvac = Fmomentum + pe * Ae;

    return {
      Ae, mdot, Me, pe, ve, Fmomentum, Fpressure, F, Fvac,
      Isp: F / (mdot * G0),
      IspVac: Fvac / (mdot * G0),
      cStar: (Pc * At) / mdot,
      Cf: F / (Pc * At),
      Tthroat: Tc * 2 / (g + 1),
      Pthroat: Pc * Math.pow(2 / (g + 1), g / (g - 1)),
      regime: nozzleFlowRegime(pe, pa),
    };
  }

  // Stage 2: propellant supply. Splits the nozzle's mass flow by mixture ratio (O/F by mass)
  // and sizes each pump. Discharge must clear Pc plus the injector drop; fuel also passes
  // through the regen cooling jacket first. Preburner pressure is added in stage 3.
  function computeSupply(p, noz) {
    const { MR, rhoO, rhoF, pTank, etaPump, injDrop, coolDrop, Pc } = p;
    const mdotO = noz.mdot * MR / (1 + MR);
    const mdotF = noz.mdot / (1 + MR);
    const pDisO = Pc * (1 + injDrop);
    const pDisF = Pc * (1 + injDrop + coolDrop);
    const dPO = pDisO - pTank, dPF = pDisF - pTank;
    const powerO = mdotO * dPO / (rhoO * etaPump);
    const powerF = mdotF * dPF / (rhoF * etaPump);
    return {
      mdotO, mdotF, QO: mdotO / rhoO, QF: mdotF / rhoF,
      pDisO, pDisF, dPO, dPF,
      headO: dPO / (rhoO * G0), headF: dPF / (rhoF * G0),
      powerO, powerF, powerTotal: powerO + powerF,
    };
  }

  // Approximate standard-atmosphere pressure (Pa) at altitude h (m).
  function ambientPressure(h) {
    if (h <= 11000) return 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
    return 22632 * Math.exp(-(h - 11000) / 6340); // roughly isothermal above the tropopause
  }

  const api = { G0, areaRatio, solveExitMach, computeNozzle, computeSupply, ambientPressure };
  if (typeof module !== 'undefined') module.exports = api; else root.RaptorEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
