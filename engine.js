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
  // and sizes each pump. By default discharge only clears Pc plus the injector drop (fuel also
  // passes through the regen cooling jacket first). Stage 3 passes pDis = { O, F } instead,
  // so the pumps clear the preburners.
  function computeSupply(p, noz, pDis) {
    const { MR, rhoO, rhoF, pTank, etaPump, injDrop, coolDrop, Pc } = p;
    const mdotO = noz.mdot * MR / (1 + MR);
    const mdotF = noz.mdot / (1 + MR);
    const pDisO = pDis ? pDis.O : Pc * (1 + injDrop);
    const pDisF = pDis ? pDis.F : Pc * (1 + injDrop + coolDrop);
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

  // Stage 3: full-flow staged combustion. Every kg of propellant passes through a preburner and
  // a turbine before reaching the main injector. The fuel-rich side drives the fuel pump and
  // the ox-rich side drives the LOX pump. Preburner temperatures are inputs (no combustion
  // chemistry yet). Turbine power must equal pump power, but pump power depends on preburner
  // pressure, which depends on the turbine pressure ratio, so iterate to a fixed point.
  function computeTurbomachinery(p, noz) {
    const { MRfpb, MRopb, Tfpb, Topb, cpF, cpO, gF, gO, etaTurb, pbDrop, Pc, injDrop, coolDrop } = p;
    const base = computeSupply(p, noz);
    const { mdotO, mdotF } = base;

    // Split each propellant between the preburners so both hold their mixture ratios:
    // fFpb + fOpb = mdotF and MRfpb*fFpb + MRopb*fOpb = mdotO
    const fOpb = (mdotO - MRfpb * mdotF) / (MRopb - MRfpb);
    const fFpb = mdotF - fOpb;
    const oFpb = MRfpb * fFpb, oOpb = MRopb * fOpb;
    const gasF = fFpb + oFpb, gasO = fOpb + oOpb;

    const pOut = Pc * (1 + injDrop); // turbine exhaust must clear the main injector
    const maxF = gasF * etaTurb * cpF * Tfpb; // turbine power at infinite pressure ratio
    const maxO = gasO * etaTurb * cpO * Topb;
    // Pressure ratio at which the turbine makes exactly `power`
    const ratio = (power, max, g) => power >= max ? Infinity : Math.pow(1 - power / max, -g / (g - 1));

    let reason = null;
    if (!(MRfpb < p.MR && p.MR < MRopb)) reason = 'Engine mixture ratio must lie between the two preburner ratios';

    let s = base, PRf = 1, PRo = 1, iterations = 0;
    if (!reason) {
      for (; iterations < 200; iterations++) {
        PRf = ratio(s.powerF, maxF, gF);
        PRo = ratio(s.powerO, maxO, gO);
        if (!isFinite(PRf) || !isFinite(PRo)) { reason = 'Turbines cannot make enough power for the pumps'; break; }
        const pPB = Math.max(PRf, PRo) * pOut * (1 + pbDrop); // pumps feed both preburners
        const next = computeSupply(p, noz, { O: pPB, F: pPB + Pc * coolDrop });
        const done = Math.abs(next.powerTotal - s.powerTotal) <= 1e-10 * next.powerTotal;
        s = next;
        if (done) break;
      }
      if (!reason && iterations === 200) reason = 'Power balance did not converge (near the turbine power limit)';
      if (!reason) {
        PRf = ratio(s.powerF, maxF, gF);
        PRo = ratio(s.powerO, maxO, gO);
        if (!isFinite(PRf) || !isFinite(PRo)) reason = 'Turbines cannot make enough power for the pumps';
      }
    }

    // Isentropic turbine expansion with efficiency etaTurb
    const Tout = (T, PR, g) => T * (1 - etaTurb * (1 - Math.pow(PR, -(g - 1) / g)));
    return {
      supply: reason ? base : s, fFpb, oFpb, fOpb, oOpb, gasF, gasO, pOut, maxF, maxO,
      PRf, PRo, Pfpb: PRf * pOut, Popb: PRo * pOut,
      TexitF: Tout(Tfpb, PRf, gF), TexitO: Tout(Topb, PRo, gO),
      feasible: !reason, reason, iterations,
    };
  }

  // Approximate standard-atmosphere pressure (Pa) at altitude h (m).
  function ambientPressure(h) {
    if (h <= 11000) return 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
    return 22632 * Math.exp(-(h - 11000) / 6340); // roughly isothermal above the tropopause
  }

  const api = { G0, areaRatio, solveExitMach, computeNozzle, computeSupply, computeTurbomachinery, ambientPressure };
  if (typeof module !== 'undefined') module.exports = api; else root.RaptorEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
