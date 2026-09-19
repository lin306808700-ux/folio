
module.exports = {
  app: { getPath: (name) => '/var/folders/_x/kkd3_hps61l8_83qvrmd3n4h0000gp/T', isReady: () => true, getName: () => 'test' },
  BrowserWindow: class { constructor() {} },
  ipcMain: { on: () => {}, handle: () => {} }
}
