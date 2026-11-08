import { CompType } from './types';

export function hitBoxOf(type: CompType): [number, number, number, number] {
  switch (type) {
    case 'dcsource':
    case 'acsource':
    case 'battery':
      return [-22, -32, 44, 64];
    case 'ground':
      return [-15, -16, 30, 30];
    case 'npn':
      return [-30, -30, 60, 60];
    case 'spdt':
      return [-28, -28, 56, 56];
    default:
      return [-30, -18, 60, 36];
  }
}

