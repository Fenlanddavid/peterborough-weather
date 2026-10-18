import type { TeleconnectionSnapshot, MJOData } from '../api/teleconnections';

export type RegimeId = 'zonal' | 'greenland-block' | 'scandinavian-block' | 'azores-ridge' | 'transitional' | 'unavailable';

export interface RegimeClassification {
  id: RegimeId;
  label: string;
  description: string;
  confidence: 'high' | 'moderate' | 'low';
  ukImpact: string;
}

export interface MJOOutlook {
  phase: number;
  amplitude: number;
  strong: boolean;
  naoImplication: string;
  confidenceNote: string;
  leadDays: string;
}

export interface TeleconnectionContext {
  regime: RegimeClassification;
  mjoOutlook: MJOOutlook | null;
  ensoState: string;
  modelNotes: string[];
}

const REGIMES: Record<RegimeId, Omit<RegimeClassification, 'confidence'>> = {
  'unavailable': {
    id: 'unavailable',
    label: 'Regime unavailable',
    description: 'Both NAO and AO indices are needed to estimate a regime.',
    ukImpact: 'There is not enough index data to describe a driving pattern for Peterborough.',
  },
  'zonal': {
    id: 'zonal',
    label: 'Atlantic Zonal',
    description: 'Active Atlantic jet stream driving weather systems from the west.',
    ukImpact: 'Often mild, wet and windy in winter. The temperature and rainfall relationship changes with season.',
  },
  'greenland-block': {
    id: 'greenland-block',
    label: 'Greenland Block',
    description: 'High pressure over Greenland deflecting the jet stream southward.',
    ukImpact: 'Can favour colder conditions in winter. Wind direction and local rain or snow depend on the position of the block.',
  },
  'scandinavian-block': {
    id: 'scandinavian-block',
    label: 'Scandinavian Block',
    description: 'High pressure anchored over Scandinavia, blocking Atlantic systems.',
    ukImpact: 'Cold continental air in winter, warm and settled in summer. Dry for eastern England.',
  },
  'azores-ridge': {
    id: 'azores-ridge',
    label: 'Azores Ridge',
    description: 'Subtropical high extending north-east towards the UK.',
    ukImpact: 'Often settled and dry, with warmth in summer but possible frost or fog in winter.',
  },
  'transitional': {
    id: 'transitional',
    label: 'Transitional',
    description: 'No dominant pattern. The atmosphere is between regimes.',
    ukImpact: 'Changeable and hard to predict. Models are likely to disagree beyond a few days.',
  },
};

function classifyRegime(nao: number, ao: number, scand: number | null): { id: RegimeId; confidence: 'high' | 'moderate' | 'low' } {
  const absNao = Math.abs(nao);
  const absAo = Math.abs(ao);

  // Strong positive NAO + positive AO → zonal
  if (nao > 0.8 && ao > 0.5) {
    return { id: 'zonal', confidence: absNao > 1.5 && absAo > 1.0 ? 'high' : 'moderate' };
  }

  // Strong negative NAO + negative AO → Greenland block
  if (nao < -0.8 && ao < -0.5) {
    return { id: 'greenland-block', confidence: absNao > 1.5 && absAo > 1.0 ? 'high' : 'moderate' };
  }

  // Positive Scand index with weak NAO → Scandinavian block
  if (scand !== null && scand > 0.8 && absNao < 1.0) {
    return { id: 'scandinavian-block', confidence: scand > 1.5 ? 'high' : 'moderate' };
  }

  // Weakly positive NAO, weak AO, no blocking → Azores ridge candidate
  if (nao > 0.3 && nao < 1.2 && ao > -0.3 && ao < 0.8 && (scand === null || scand < 0.5)) {
    return { id: 'azores-ridge', confidence: 'low' };
  }

  // Marginal signals
  if (absNao < 0.8 && absAo < 0.8) {
    return { id: 'transitional', confidence: 'low' };
  }

  // Weak but directional
  if (nao > 0.5) return { id: 'zonal', confidence: 'low' };
  if (nao < -0.5) return { id: 'greenland-block', confidence: 'low' };

  return { id: 'transitional', confidence: 'low' };
}

function mjoOutlook(mjo: MJOData): MJOOutlook {
  const strong = mjo.amplitude > 1.5;
  let naoImplication: string;
  let leadDays: string;

  if (!strong) {
    return {
      phase: mjo.phase,
      amplitude: mjo.amplitude,
      strong: false,
      naoImplication: 'Weak MJO signal — limited teleconnection influence on the UK.',
      confidenceNote: 'When the MJO is weak, its influence on mid-latitude weather patterns is minimal.',
      leadDays: '',
    };
  }

  // MJO phase → NAO implications (well-established relationships)
  switch (mjo.phase) {
    case 1:
      naoImplication = 'MJO Phase 1 can support a transition toward positive NAO.';
      leadDays = '10–15 days';
      break;
    case 2:
      naoImplication = 'MJO Phase 2 may favour positive NAO in winter, increasing the chance of Atlantic weather.';
      leadDays = '10–15 days';
      break;
    case 3:
      naoImplication = 'MJO Phase 3 may favour positive NAO and a more active Atlantic jet in winter.';
      leadDays = '10–14 days';
      break;
    case 4:
      naoImplication = 'MJO Phase 4 is transitional — NAO signal is mixed.';
      leadDays = '7–14 days';
      break;
    case 5:
      naoImplication = 'MJO Phase 5 can begin to weaken the polar vortex.';
      leadDays = '10–20 days';
      break;
    case 6:
      naoImplication = 'MJO Phase 6 may favour negative NAO in winter, increasing the chance of blocking and colder conditions.';
      leadDays = '10–14 days';
      break;
    case 7:
      naoImplication = 'MJO Phase 7 may favour negative NAO and blocking in winter; local conditions depend on the wider pattern.';
      leadDays = '10–14 days';
      break;
    case 8:
      naoImplication = 'MJO Phase 8 supports high pressure building — can prolong or trigger blocking.';
      leadDays = '7–14 days';
      break;
    default:
      naoImplication = 'MJO phase data unavailable.';
      leadDays = '';
  }

  const confidenceNote = mjo.amplitude > 2.0
    ? 'A larger MJO amplitude gives a clearer tropical signal, but its UK influence varies with season and the wider pattern.'
    : 'Moderate MJO amplitude — the signal is present but may be modulated by other factors.';

  return { phase: mjo.phase, amplitude: mjo.amplitude, strong, naoImplication, confidenceNote, leadDays };
}

function ensoLabel(value: number | null): string {
  if (value === null) return 'ENSO data unavailable';
  if (value >= 0.5) return 'El Niño';
  if (value <= -0.5) return 'La Niña';
  return 'ENSO-neutral';
}

function modelNotes(regime: RegimeClassification, mjo: MJOOutlook | null): string[] {
  const notes: string[] = [];

  if (regime.id === 'greenland-block' || regime.id === 'scandinavian-block') {
    notes.push('Blocking persistence can be difficult to forecast. Compare model agreement and successive runs.');
  }

  if (regime.id === 'transitional') {
    notes.push('Models are likely to show high flip-flop rates in transitional regimes.');
  }

  if (mjo?.strong && (mjo.phase === 6 || mjo.phase === 7)) {
    notes.push('An active MJO in phases 6–7 can influence winter circulation, but does not by itself predict stratospheric disruption.');
  }

  if (regime.id === 'zonal' && regime.confidence === 'high') {
    notes.push('Strong zonal flow is generally well-handled by all models — higher forecast confidence.');
  }

  return notes;
}

export function classifyTeleconnections(snapshot: TeleconnectionSnapshot): TeleconnectionContext {
  const naoVal = snapshot.nao?.value;
  const aoVal = snapshot.ao?.value;
  const scandVal = snapshot.scand?.value ?? null;
  const ensoVal = snapshot.enso?.value ?? null;

  const { id, confidence } = naoVal !== undefined && aoVal !== undefined
    ? classifyRegime(naoVal, aoVal, scandVal)
    : { id: 'unavailable' as const, confidence: 'low' as const };
  const regime: RegimeClassification = { ...REGIMES[id], confidence };

  const mjo = snapshot.mjo ? mjoOutlook(snapshot.mjo) : null;

  return {
    regime,
    mjoOutlook: mjo,
    ensoState: ensoLabel(ensoVal),
    modelNotes: modelNotes(regime, mjo),
  };
}
