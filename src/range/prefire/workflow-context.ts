import {createContext} from 'react';
import type {CoachingSummary} from '../coaching-types';
import type {AngleDiagnosis} from './training-log';
import type {PracticeBlock, PracticePhase} from '../adaptive-practice';
export const PrefireWorkflow = createContext<{diagnoses: readonly AngleDiagnosis[]; retry: (diagnosis: AngleDiagnosis) => void;
  lesson?: (summary: CoachingSummary) => void; message?: string; block?: PracticeBlock; end?: () => void;
  next?: (phase: PracticePhase) => void; activeKey?: string; saveRetention?: () => void; retention?: {due: string; start: () => void}}>({diagnoses: [], retry: () => {}});
