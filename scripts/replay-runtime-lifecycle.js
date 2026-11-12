Module.disposeReplayEngine = function() {
  Browser.mainLoop.pause();
  if (typeof JSEvents !== 'undefined') JSEvents.removeAllEventListeners();
  if (typeof SDL !== 'undefined' && SDL.quit) SDL.quit();
};
