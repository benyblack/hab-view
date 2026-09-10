/* ==========================================================================
 * react-core — React bindings for <wick-chart> (pure logic, no side effects).
 *
 *   import { WickChart, useWickChart } from 'wickchart/react';
 *
 *   <WickChart type="candles" indicators="sma:20 volume" volshading
 *              data={bars} onRange={fn} onAlert={fn} style={{ height: 420 }} />
 *
 * Props map onto the element 1:1:
 *   - string/number/boolean props become attributes ("indicators", "type", …)
 *   - `data` assigns the bar array (pass a fresh array to trigger an update)
 *   - `overlays` assigns server-side zones & levels via setOverlays()
 *   - `onRange` / `onAlert` / … subscribe to the matching `wick:range`,
 *     `wick:alert`, … events and unsubscribe on unmount; an `events`
 *     object ({ range: fn }) works too
 *   - className/style/id/… are passed through to React as usual
 *
 * This module never touches the DOM at import time and does NOT define the
 * element — the package entry (src/react.js) imports <wick-chart> for its
 * side effect, which keeps this file importable in tests and on the server.
 * Requires React >= 16.8 (hooks) — see peerDependencies in package.json.
 * ========================================================================== */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  createElement,
  forwardRef,
} from 'react';

/** useEffect on the server, useLayoutEffect in the browser (avoids the SSR warning). */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Map an event shorthand to the dispatched event name.
 * "range" / "wick:range" → "wick:range" (the 0.x "hab:" prefix is no longer emitted).
 * @param {string} name
 * @returns {string}
 */
export const toWickEventName = (name) =>
  String(name).startsWith('wick:') ? String(name) : 'wick:' + String(name);

/**
 * camelCase prop name → kebab-case attribute name ("volShading" → "vol-shading").
 * @param {string} key
 * @returns {string}
 */
export const toAttrName = (key) => key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const DOM_PROPS = new Set(['className', 'class', 'style', 'id', 'title', 'role', 'key', 'ref']);

/**
 * Split React props into chart attrs / event handlers / DOM passthrough /
 * the data array / the overlays array.
 * @param {object} props
 * @returns {{ attrs: object, events: Record<string, Function>, dom: object, data: any, overlays: any }}
 */
export function splitChartProps(props) {
  const attrs = {};
  const events = {};
  const dom = {};
  let data;
  let overlays;
  for (const [key, val] of Object.entries(props || {})) {
    if (key === 'data') {
      data = val;
    } else if (key === 'overlays') {
      overlays = val;
    } else if (key === 'events') {
      for (const [name, fn] of Object.entries(val || {})) events[name] = fn;
    } else if (/^on[A-Z]/.test(key)) {
      events[key.slice(2, 3).toLowerCase() + key.slice(3)] = val;
    } else if (
      DOM_PROPS.has(key) ||
      key.startsWith('aria-') ||
      key.startsWith('data-') ||
      typeof val === 'object'
    ) {
      dom[key] = val;
    } else {
      attrs[key] = val;
    }
  }
  return { attrs, events, dom, data, overlays };
}

/**
 * Apply split props to a chart element. Every write is guarded so re-running
 * with identical values is a no-op (attributes compared as strings, `data`
 * and `overlays` compared by identity — passing a fresh array is what
 * triggers a redraw).
 * @param {HTMLElement} el
 * @param {{ attrs?: object, data?: any, overlays?: any }} split
 */
export function applyChartProps(el, split) {
  if (!el) return;
  for (const [key, val] of Object.entries(split.attrs || {})) {
    const name = toAttrName(key);
    if (val == null || val === false) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else {
      const str = val === true ? '' : String(val);
      if (el.getAttribute(name) !== str) el.setAttribute(name, str);
    }
  }
  // The element exposes `data` as a getter-only accessor — feed it through
  // setData() (guarded by identity so unchanged arrays never re-ingest).
  // setData() normalizes into a *fresh* array, so `el.data` never matches
  // what we passed in; the identity we compare against is tracked on the
  // element, exactly as overlays do below. Comparing `el.data` instead would
  // re-ingest on every render — which resets the viewport, since setData()
  // sets `_needsFit` and clears the hover.
  if (split.data != null && el.__wickDataRef !== split.data) {
    el.__wickDataRef = split.data;
    if (typeof el.setData === 'function') el.setData(split.data);
    else el.data = split.data;
  }
  // Overlays follow the same rule through setOverlays(); identity is tracked
  // on the element because the getter returns copies.
  if (split.overlays != null && el.__wickOverlaysRef !== split.overlays) {
    el.__wickOverlaysRef = split.overlays;
    if (typeof el.setOverlays === 'function') el.setOverlays(split.overlays);
  }
}

/**
 * Full control hook: renders nothing — attach the returned ref to your own
 * <wick-chart> element and pass the same options you would give the component.
 *
 *   const { ref, chart } = useWickChart({ data: bars, indicators: 'sma:20', onRange });
 *   return <wick-chart ref={ref} style={{ height: 420 }} />;
 *   // chart.getDataWindow() etc. once mounted
 *
 * @param {object} [options] any <wick-chart> attribute, plus `data`, `events`
 *   and `onXxx`-style handlers (see splitChartProps).
 * @returns {{ ref: (node: any) => void, chart: any }} `chart` is the element
 *   instance (or null before mount) for the imperative API.
 */
export function useWickChart(options = {}) {
  const split = splitChartProps(options);
  const splitRef = useRef(split);
  splitRef.current = split;

  const [chart, setChart] = useState(null);
  const ref = useCallback((node) => { setChart(node); }, []);

  // Apply attrs/data on every commit — guarded writes make this cheap, and it
  // catches both prop changes and the element mounting after the first render.
  useIsomorphicLayoutEffect(() => {
    if (chart) applyChartProps(chart, splitRef.current);
  });

  // Subscribe to wick:* events through stable trampolines so subscriptions
  // only churn when the set of event names changes — not on every render.
  const eventsRef = useRef(split.events);
  eventsRef.current = split.events;
  const names = Object.keys(split.events).join(' ');
  useEffect(() => {
    if (!chart || !names) return undefined;
    const offs = names.split(' ').map((key) => {
      const type = toWickEventName(key);
      const trampoline = (ev) => {
        const fn = eventsRef.current[key];
        if (fn) fn(ev);
      };
      chart.addEventListener(type, trampoline);
      return () => chart.removeEventListener(type, trampoline);
    });
    return () => { for (const off of offs) off(); };
  }, [chart, names]);

  return { ref, chart };
}

/**
 * Drop-in React component for <wick-chart>. Attributes ride through
 * createElement (so they exist at first paint and in SSR output) while the
 * hook keeps them in sync on updates; `data` and event handlers never touch
 * React's prop pipeline. Works the same on React 16.8 → 19.
 */
export const WickChart = forwardRef(function WickChart(props, fwdRef) {
  const { ref } = useWickChart(props);
  const { attrs, dom } = splitChartProps(props);
  const setEl = useCallback(
    (node) => {
      ref(node);
      if (typeof fwdRef === 'function') fwdRef(node);
      else if (fwdRef) fwdRef.current = node;
    },
    [ref, fwdRef]
  );
  return createElement('wick-chart', { ...dom, ...attrs, ref: setEl });
});

export default WickChart;
