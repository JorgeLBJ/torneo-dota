// Pure helpers for the live Capturas GSI screens (no DOM), loaded as a plain script before admin.js.
var AdminLiveCore = (function () {
  /**
   * Leading + trailing throttle. The first trigger runs at once and opens a window of `ms`; triggers inside
   * the window collapse into one more run when it closes (which opens the next window). `timers` is injected
   * so tests can drive it.
   */
  function createThrottle(run, ms, timers) {
    var timer = null;
    var pending = false;

    function open() {
      timer = timers.setTimeout(function () {
        timer = null;
        if (pending) {
          pending = false;
          run();
          open();
        }
      }, ms);
    }

    return {
      trigger: function () {
        if (timer !== null) {
          pending = true;
          return;
        }
        run();
        open();
      },
      cancel: function () {
        pending = false;
        if (timer !== null) timers.clearTimeout(timer);
        timer = null;
      },
    };
  }

  /** Keys present after a refresh that were not there before, in their new order. */
  function newKeys(before, after) {
    var seen = {};
    before.forEach(function (key) {
      seen[key] = true;
    });
    return after.filter(function (key) {
      return !seen[key];
    });
  }

  return { createThrottle: createThrottle, newKeys: newKeys };
})();
