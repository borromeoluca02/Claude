/* regulation.js — dati del Regolamento Tecnico Inline Freestyle FISR 2025-2026.
   Riferimenti: Art. 64 (attrezzatura/ostacoli) e Art. 65 (campo di gara) per il
   Roller Cross, Art. 102 per lo Skate Cross, Allegato 3 per i disegni quotati
   delle rampe. Le misure sono in metri salvo diversa indicazione.
   Nel regolamento le quote dell'Allegato 3 sono dichiarate "puramente
   indicative": qui servono come valori di partenza, sempre modificabili. */

export const REG_SOURCE = 'FISR — Regolamento Tecnico Inline Freestyle 2025-2026 (v. 19-1-2026)';

/* ------------------------------------------------------------ ROLLER CROSS */

export const ROLLER = {
  ref: 'Art. 65',
  totalLengthMin: 250,
  totalLengthMax: 300,
  laneWidthMin: 3.5,           // escluso rettilineo di partenza e prima curva
  startLaneWidthMin: 5,        // rettilineo di partenza e prima curva
  startStraightMinLength: 20,  // lunghezza minima del rettilineo di partenza
  startLanesLength: 5,         // corsie separate dopo la linea
  startLaneWidth: 1.25,        // larghezza minima delle corsie separate
  startBoxes: 4,
  startBoxLength: 1,
  gapMin: 5,                   // distanza minima fra ostacoli
  gapMax: 25,                  // distanza massima fra ostacoli
  firstObstacleMin: 12,        // partenza → primo ostacolo
  finishMin: 10,               // ultimo ostacolo → linea di arrivo
  curvesRightMin: 2,
  curvesLeftMin: 2,
  firstCurveWindow: 10,        // curva entro 10 m dalla fine del rettilineo iniziale
  firstCurveMinWidth: 5,
  firstCurveMinAngle: 50,
  rampWidthMin: 1.8,
  rampHeightMin: 0.4,
  dryJumpConsecutiveMin: 10,   // due salti a secco rigidi consecutivi
  groups: { gimkane: 1, barriere: 4, rampe: 3, rampeTipologie: 2 },
  gimkana: {
    minElements: 3, laneWidthMin: 5, elemGapMin: 3, elemGapMax: 5,
    centerCross: 0.75, inCurveRadiusMin: 5, inCurveWidthMin: 4,
  },
  innerCurveDelimiter: 'new jersey di plastica o 3 pneumatici sovrapposti (solo per curve con raggio da 0 a 1 m)',
};

/* altezze per categoria (tolleranza ±2 cm) */
export const CATEGORIES = [
  { key: 'gioeso', label: 'Giovanissimi / Esordienti', dryJump: 0.30, underpass: 0.90 },
  { key: 'ragallmas', label: 'Ragazzi / Allievi / Master', dryJump: 0.40, underpass: 1.10 },
  { key: 'junsen', label: 'Juniores / Seniores', dryJump: 0.50, underpass: 1.10 },
];
export const categoryInfo = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[1];

/* ------------------------------------------------------------- SKATE CROSS */

export const SKATE = {
  ref: 'Art. 102',
  laneWidthMin: 5,
  gates: 4,
  startRampMaxHeight: 2,
  tightCurves: { count: 2, radiusMax: 5 },      // almeno 2 curve di raggio < 5 m
  ramps: { count: 3, heightMin: 0.5 },          // rampe, curve o bank to bank
  funbox: { count: 2, heightMin: 1.5, heightMax: 2, width: 4 },
  finishFullWidth: true,
};

/* rampa di partenza — Allegato 3 */
export const START_RAMP_REG = {
  platformLength: 2.0,
  height: 2.0,
  slopeLength: 4.8,
  slopeAngle: 25,
  get groundLength() { return this.platformLength + this.slopeLength * Math.cos(this.slopeAngle * Math.PI / 180); },
};

/* ------------------------------------------------- regole di default per disciplina */

export function rulePreset(discipline) {
  if (discipline === 'skate') {
    return {
      minGap: 5, maxGap: 25,          // non normate per lo skate cross: valori di lavoro
      minWidth: SKATE.laneWidthMin,
      maxWidth: SKATE.laneWidthMin,
      minRadius: 0,
      firstObstacleMin: 0,
      finishMin: 0,
      checkArea: true,
      regCheck: true,
    };
  }
  return {
    minGap: ROLLER.gapMin,
    maxGap: ROLLER.gapMax,
    minWidth: ROLLER.laneWidthMin,
    maxWidth: ROLLER.startLaneWidthMin,
    minRadius: 0,
    firstObstacleMin: ROLLER.firstObstacleMin,  // dalla linea di partenza
    finishMin: ROLLER.finishMin,                // ultimo ostacolo → arrivo
    checkArea: true,
    regCheck: true,
  };
}
