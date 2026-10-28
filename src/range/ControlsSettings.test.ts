import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it} from 'vitest';
import {ControlsSettings, MouseSettings} from './ControlsSettings';
import {defaults} from './config';
import {controlActions, controlLabels, defaultControls} from './controls';

it('renders accessible rebind/reset buttons for every action with shortcut safety feedback', () => {
  const html = renderToStaticMarkup(createElement(ControlsSettings, {value: {...defaultControls, forward: 'ArrowUp'}, onChange: () => {}}));
  for (const action of controlActions) expect(html).toContain(`aria-label="Bind ${controlLabels[action].toLowerCase()}"`);
  expect(html).toContain('Arrow Up'); expect(html).toContain('Ctrl+W'); expect(html).toContain('C always crouches');
  expect(html).toContain('aria-label="Reset all controls"'); expect(html).toContain('aria-live="polite"');
});
it('shows physical cm/360, explicit calibration, zoom ratio and untested raw-input status', () => {
  const html = renderToStaticMarkup(createElement(MouseSettings, {settings: defaults, onChange: () => {}}));
  expect(html).toContain('51.95 cm'); expect(html).toContain('Mouse capture not tested');
  expect(html).toContain('aria-label="Zoom sensitivity ratio"'); expect(html).toContain('aria-label="Browser count calibration"');
  expect(html).toContain('no automatic devicePixelRatio'); expect(html).toContain('cannot fix');
  expect(html).toContain('type="number"');
});
it('renders concise wheel labels with mouse icons for jump and other pulse actions', () => {
  const html = renderToStaticMarkup(createElement(ControlsSettings, {
    value: {...defaultControls, jump: 'WheelUp', reload: 'WheelDown'}, onChange: () => {},
  }));
  expect(html).toContain('Wheel Up'); expect(html).toContain('Wheel Down');
  expect(html.match(/lucide-mouse/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Bind jump"'); expect(html).toContain('aria-label="Reset jump"');
  expect(html).not.toContain('WheelUp'); expect(html).not.toContain('WheelDown');
});
