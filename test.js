const { computeNozzle, computeSupply, computeTurbomachinery } = require('./engine.js');
let bad = 0;
function check(name, r, expect) {
  console.log(`-- ${name}`);
  for (const [k, v] of Object.entries(expect)) {
    const err = Math.abs(r[k] - v) / Math.abs(v);
    const ok = err < 2e-3;
    if (!ok) bad++;
    console.log(ok ? 'ok  ' : 'FAIL', k.padEnd(10), r[k].toPrecision(6), 'expected', v);
  }
}

const r = computeNozzle({ Pc: 10e6, Tc: 3500, gamma: 1.2, R: 350, At: 0.01, areaRatio: 20, pa: 101325 });
check('stage 1 nozzle', r, { Ae: 0.2, mdot: 58.595, Me: 3.7585, pe: 50705, ve: 2933.8, Fmomentum: 171906, Fpressure: -10124, F: 161782 });

// Hand calc: mdotO = 58.595*3.6/4.6, dPO = 10e6*1.2 - 0.3e6, power = mdot*dP/(rho*eta)
const s = computeSupply({ MR: 3.6, rhoO: 1141, rhoF: 423, pTank: 300e3, etaPump: 0.75, injDrop: 0.2, coolDrop: 0.1, Pc: 10e6 }, r);
check('stage 2 supply', s, { mdotO: 45.857, mdotF: 12.738, QO: 0.040190, QF: 0.030114, dPO: 11.7e6, dPF: 12.7e6, headO: 1045.6, headF: 3061.6, powerO: 626970, powerF: 509926 });

// Expected values from an independent Python re-derivation of the same equations
const p3 = { Pc: 10e6, MR: 3.6, rhoO: 1141, rhoF: 423, pTank: 300e3, etaPump: 0.75, injDrop: 0.2, coolDrop: 0.1,
  MRfpb: 0.25, MRopb: 50, Tfpb: 1000, Topb: 800, cpF: 3500, cpO: 1100, gF: 1.18, gO: 1.33, etaTurb: 0.7, pbDrop: 0.15 };
const t = computeTurbomachinery(p3, r);
check('stage 3 turbomachinery', t, { fOpb: 0.85774, fFpb: 11.8804, gasF: 14.8505, gasO: 43.7448, PRf: 1.12665, PRo: 1.13294,
  Pfpb: 13.5198e6, Popb: 13.5953e6, TexitF: 987.38, TexitO: 782.92 });
check('stage 3 coupled pumps', t.supply, { pDisO: 15.6346e6, pDisF: 16.6346e6, powerO: 821736, powerF: 655860 });

// Above ~27 MPa the ox-rich turbine can't keep up with its pump: no power balance exists
const hi = { ...p3, Pc: 30e6 };
const t30 = computeTurbomachinery(hi, computeNozzle({ Pc: 30e6, Tc: 3500, gamma: 1.2, R: 350, At: 0.01, areaRatio: 20, pa: 101325 }));
const okHi = !t30.feasible && t30.reason !== null;
if (!okHi) bad++;
console.log(okHi ? 'ok  ' : 'FAIL', 'Pc = 30 MPa reported infeasible:', t30.reason);

process.exit(bad ? 1 : 0);
