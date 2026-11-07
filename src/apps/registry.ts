/**
 * Application registry. Each app is a pair of files: an OML interface and an
 * OSL script. The kernel mounts them into a window.
 */
import filesOml from './files/files.oml?raw';
import filesOsl from './files/files.osl?raw';
import editorOml from './editor/editor.oml?raw';
import editorOsl from './editor/editor.osl?raw';
import terminalOml from './terminal/terminal.oml?raw';
import terminalOsl from './terminal/terminal.osl?raw';
import settingsOml from './settings/settings.oml?raw';
import settingsOsl from './settings/settings.osl?raw';
import aboutOml from './about/about.oml?raw';
import aboutOsl from './about/about.osl?raw';
import calculatorOml from './calculator/calculator.oml?raw';
import calculatorOsl from './calculator/calculator.osl?raw';
import notesOml from './notes/notes.oml?raw';
import notesOsl from './notes/notes.osl?raw';
import calendarOml from './calendar/calendar.oml?raw';
import calendarOsl from './calendar/calendar.osl?raw';
import monitorOml from './monitor/monitor.oml?raw';
import monitorOsl from './monitor/monitor.osl?raw';
import ideOml from './ide/ide.oml?raw';
import ideOsl from './ide/ide.osl?raw';
import tasksOml from './tasks/tasks.oml?raw';
import tasksOsl from './tasks/tasks.osl?raw';
import clockOml from './clock/clock.oml?raw';
import clockOsl from './clock/clock.osl?raw';
import previewOml from './preview/preview.oml?raw';
import previewOsl from './preview/preview.osl?raw';
import viewerOml from './viewer/viewer.oml?raw';
import viewerOsl from './viewer/viewer.osl?raw';
import docsOml from './docs/docs.oml?raw';
import docsOsl from './docs/docs.osl?raw';
import logsOml from './logs/logs.oml?raw';
import logsOsl from './logs/logs.osl?raw';
import runOml from './run/run.oml?raw';
import runOsl from './run/run.osl?raw';

export interface AppDef {
  id: string;
  name: string;
  icon: string;
  width: number;
  height: number;
  /** Floor for user resizing — below this the OML layout starts to break. */
  minWidth: number;
  minHeight: number;
  oml: string;
  osl: string;
  /** Hidden from the launcher, dock and taskbar defaults (e.g. Run). */
  hidden?: boolean;
}

export const APPS: AppDef[] = [
  { id: 'files', name: 'File Manager', icon: 'app-files', width: 900, height: 560, minWidth: 620, minHeight: 400, oml: filesOml, osl: filesOsl },
  { id: 'terminal', name: 'Terminal', icon: 'app-terminal', width: 800, height: 500, minWidth: 460, minHeight: 280, oml: terminalOml, osl: terminalOsl },
  { id: 'editor', name: 'Editor', icon: 'app-editor', width: 820, height: 600, minWidth: 520, minHeight: 360, oml: editorOml, osl: editorOsl, hidden: true },
  { id: 'ide', name: 'IDE', icon: 'app-ide', width: 1140, height: 700, minWidth: 780, minHeight: 520, oml: ideOml, osl: ideOsl },
  { id: 'notes', name: 'Notes', icon: 'app-notes', width: 780, height: 560, minWidth: 520, minHeight: 380, oml: notesOml, osl: notesOsl },
  { id: 'tasks', name: 'Tasks', icon: 'app-tasks', width: 760, height: 600, minWidth: 520, minHeight: 420, oml: tasksOml, osl: tasksOsl },
  { id: 'calendar', name: 'Calendar', icon: 'app-calendar', width: 660, height: 580, minWidth: 460, minHeight: 460, oml: calendarOml, osl: calendarOsl },
  { id: 'clock', name: 'Clock', icon: 'app-clock', width: 760, height: 500, minWidth: 460, minHeight: 360, oml: clockOml, osl: clockOsl },
  { id: 'preview', name: 'Preview', icon: 'app-preview', width: 900, height: 620, minWidth: 520, minHeight: 380, oml: previewOml, osl: previewOsl, hidden: true },
  { id: 'viewer', name: 'Image Viewer', icon: 'app-image', width: 940, height: 640, minWidth: 540, minHeight: 400, oml: viewerOml, osl: viewerOsl },
  { id: 'docs', name: 'Language Docs', icon: 'app-docs', width: 900, height: 620, minWidth: 620, minHeight: 440, oml: docsOml, osl: docsOsl },
  { id: 'monitor', name: 'Monitor', icon: 'app-monitor', width: 760, height: 540, minWidth: 520, minHeight: 380, oml: monitorOml, osl: monitorOsl },
  { id: 'logs', name: 'Logs', icon: 'app-logs', width: 880, height: 560, minWidth: 560, minHeight: 380, oml: logsOml, osl: logsOsl },
  { id: 'settings', name: 'Settings', icon: 'app-settings', width: 820, height: 600, minWidth: 640, minHeight: 460, oml: settingsOml, osl: settingsOsl },
  { id: 'calculator', name: 'Calculator', icon: 'app-calc', width: 340, height: 480, minWidth: 300, minHeight: 420, oml: calculatorOml, osl: calculatorOsl },
  { id: 'about', name: 'About', icon: 'app-about', width: 540, height: 620, minWidth: 420, minHeight: 480, oml: aboutOml, osl: aboutOsl },
  { id: 'run', name: 'Run', icon: 'command', width: 520, height: 430, minWidth: 420, minHeight: 340, oml: runOml, osl: runOsl, hidden: true },
];

export function getApp(id: string): AppDef | undefined {
  return APPS.find((a) => a.id === id);
}
