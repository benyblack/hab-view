/* ==========================================================================
 * wickchart/react — React bindings for <wick-chart> (package entry).
 *
 *   import { WickChart, useWickChart } from 'wickchart/react';
 *
 * Importing this module also defines the <wick-chart> custom element (same
 * side-effect contract as wickchart/feed). All binding logic lives in
 * ./react-core.js; SSR-safe on the server (the define call is guarded).
 * ========================================================================== */
import './wick-chart.js';

export {
  WickChart,
  useWickChart,
  splitChartProps,
  applyChartProps,
  toWickEventName,
  toAttrName,
} from './react-core.js';

export { default } from './react-core.js';
