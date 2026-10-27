// npm run calibrate — prints the scoring calibration table.
//
// Exists so the methodology can be checked and argued about from a terminal
// rather than taken on trust from a paragraph in a report.

import { calibrate, formatCalibration } from './calibration.js';
import { REFERENCE_RESUME, REFERENCE_PAIRS } from './reference-pairs.js';

console.log('\nHiveFit scoring calibration');
console.log('Resume scored against a labelled ladder of postings, best match first.\n');
console.log(formatCalibration(calibrate({ resume: REFERENCE_RESUME, pairs: REFERENCE_PAIRS })));
console.log('');
console.log('spread   = best score minus worst. A metric with no spread cannot rank.');
console.log('margin   = tightest gap between adjacent tiers. Thin margins make band');
console.log('           boundaries noise rather than signal.');
console.log('ordering = whether the metric ranked the ladder in the labelled order.');
console.log('');
