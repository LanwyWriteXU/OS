/**
 * OS — boot entry point.
 */
import './styles/base.css';
import './styles/shell.css';
import './styles/apps.css';
import './styles/terminal.css';

import { Vfs } from './core/fs';
import { settings } from './core/settings';
import { Kernel } from './core/kernel';
import { t } from './i18n';

async function main() {
  settings.load();
  const vfs = new Vfs();
  await vfs.init();

  const kernel = new Kernel(vfs, settings);
  const root = document.getElementById('root')!;
  await kernel.boot(root);

  settings.onChange(() => kernel.shellUi?.scheduleRefresh());

  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 700);
  }

  // expose for debugging and for the in-page test harness
  (window as any).OS = { kernel, vfs, settings };

  const firstRun = !localStorage.getItem('os.seen');
  if (firstRun) {
    localStorage.setItem('os.seen', '1');
    setTimeout(() => kernel.open('editor', { path: '/home/user/Documents/welcome.md' }), 450);
    setTimeout(
      () => kernel.notify(t('Welcome to OS'), t('Press Ctrl+Space for the start menu, or open Terminal and run fastfetch.'), 'sparkles'),
      1500,
    );
  } else {
    setTimeout(() => kernel.notify('OS 1.1 "Origin"', t('Welcome back. Ctrl+Alt+T opens a terminal.'), 'app-about'), 900);
  }
}

main().catch((err) => {
  console.error(err);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div class="fatal">
        <h1>OS failed to start</h1>
        <pre>${String(err?.stack ?? err?.message ?? err)}</pre>
      </div>`;
  }
  document.getElementById('boot')?.classList.add('done');
});
