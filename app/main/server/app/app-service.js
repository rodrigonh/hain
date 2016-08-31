'use strict';

const lo_includes = require('lodash.includes');
const co = require('co');
const cp = require('child_process');

const electron = require('electron');
const electronApp = electron.app;

const AutoLaunch = require('./auto-launch');
const MainWindow = require('./ui/main-window');
const PrefWindow = require('./ui/pref-window');
const TrayService = require('./ui/tray-service');

const firstLaunch = require('./first-launch');
const ShortcutService = require('./shortcut-service');
const iconProtocol = require('./icon-protocol');

module.exports = class AppService {
  constructor(appPref, workerClient, workerProxy) {
    this._isRestarting = false;

    this.appPref = appPref;
    this.autoLaunch = new AutoLaunch();
    this.mainWindow = new MainWindow(workerProxy);
    this.prefWindow = new PrefWindow();
    this.trayService = new TrayService(this, this.autoLaunch);
    this.shortcutService = new ShortcutService(this, appPref);
    this.workerClient = workerClient;
  }
  initializeAndLaunch() {
    const self = this;
    return co(function* () {
      if (firstLaunch.isFirstLaunch)
        self.autoLaunch.activate();

      const isRestarted = (lo_includes(process.argv, '--restarted'));
      const silentLaunch = (lo_includes(process.argv, '--silent'));
      const shouldQuit = electronApp.makeSingleInstance((cmdLine, workingDir) => {
        if (self._isRestarting)
          return;
        self.mainWindow.show();
      });

      if (shouldQuit && !isRestarted)
        return electronApp.quit();

      electronApp.on('ready', () => {
        self.trayService.createTray();
        self.shortcutService.initializeShortcuts();
        self.mainWindow.createWindow(() => {
          if (!silentLaunch || isRestarted)
            self.mainWindow.show();
          if (isRestarted)
            self.mainWindow.enqueueToast('Restarted');
        });
        iconProtocol.register();
      });
      // TODO 위 createTray가 먼저 실행될 가능성이 있음

      yield self.autoLaunch.initialize();
    }).catch((err) => {
      console.log(err);
    });
  }
  open(query) {
    this.mainWindow.show();
    if (query !== undefined)
      this.mainWindow.setQuery(query);
  }
  restart() {
    if (this._isRestarting)
      return;
    this._isRestarting = true;

    const argv = [].concat(process.argv);
    if (!lo_includes(argv, '--restarted'))
      argv.push('--restarted');
    if (!argv[0].startsWith('"'))
      argv[0] = `"${argv[0]}"`;

    cp.exec(argv.join(' '));
    setTimeout(() => electronApp.quit(), 500);
  }
  quit() {
    electronApp.quit();
  }
  openPreferences(prefId) {
    this.prefWindow.show(prefId);
  }
  reloadPlugins() {
    this.workerClient.reloadWorker();
    this.workerProxy.initialize(this.appPref.get());
    this.mainWindow.setQuery('');
    this.mainWindow.notifyPluginsReloading();
  }
};
