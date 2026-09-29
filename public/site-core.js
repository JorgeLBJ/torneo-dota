// Pure helpers of the public page (no DOM access), so they can be unit-tested in Node.
// Times arrive from the server as ISO UTC instants; here they are shown in a given IANA time zone.
(function (root) {
  'use strict';

  var MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  function parts(iso, timeZone) {
    var out = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .forEach(function (p) {
        out[p.type] = p.value;
      });
    return out;
  }

  /** "2026-10-03" for the calendar day of the instant in the zone, or null without an instant. */
  function dayKey(iso, timeZone) {
    if (!iso) return null;
    var p = parts(iso, timeZone);
    return p.year + '-' + p.month + '-' + p.day;
  }

  /** "21:00" (24 hours). */
  function formatTime(iso, timeZone) {
    var p = parts(iso, timeZone);
    return p.hour + ':' + p.minute;
  }

  /** "11 Oct · 14:00" */
  function formatShort(iso, timeZone) {
    var p = parts(iso, timeZone);
    return p.day + ' ' + MONTHS[Number(p.month) - 1] + ' · ' + p.hour + ':' + p.minute;
  }

  /** "sábado, 03 de octubre" for a "YYYY-MM-DD" key, or "Sin fecha". */
  function dayLabel(key) {
    if (!key) return 'Sin fecha';
    return new Intl.DateTimeFormat('es', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' }).format(
      new Date(key + 'T00:00:00Z'),
    );
  }

  /**
   * Where a new day heading starts in a chronological list of instants (null = unscheduled, kept last).
   * Returns [{ index, key, label }]: the heading goes before the item at `index`.
   */
  function groupDays(isos, timeZone) {
    var groups = [];
    var previous;
    isos.forEach(function (iso, index) {
      var key = dayKey(iso, timeZone);
      if (index === 0 || key !== previous) groups.push({ index: index, key: key, label: dayLabel(key) });
      previous = key;
    });
    return groups;
  }

  // ---- Live updates -----------------------------------------------------------------------------

  var CLOSED = 2; // EventSource.CLOSED
  var BACKOFF_BASE_MS = 1000;
  var BACKOFF_CAP_MS = 30000;
  var REFRESH_JITTER_MS = 500;

  /** Reconnect delay: exponential from 1 s, capped at 30 s, with "equal jitter" (half fixed, half random). */
  function backoffDelay(attempt, random) {
    var step = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt));
    return Math.round(step / 2 + (random() * step) / 2);
  }

  /**
   * Keeps a page in sync with the server. All browser access is injected (`deps`), so it runs under test:
   * connect(url) -> EventSource-like, fetchFragment() -> Promise<html|null>, swap(html), setLive(bool),
   * setTimeout/clearTimeout, random().
   * - "change" events schedule one refresh after a random 0-500 ms, so a crowd of visitors does not
   *   fetch in the same instant; bursts collapse into one fetch and fetches never overlap.
   * - When the browser gives up on the connection (an HTTP error closes an EventSource for good), it is
   *   reopened by hand with capped exponential backoff. While the browser is still retrying, it is left alone.
   * - A reconnect refreshes once, in case changes were missed while disconnected.
   */
  function createLive(deps) {
    var source = null;
    var attempt = 0;
    var connectedBefore = false;
    var stopped = false;
    var refreshTimer = null;
    var reconnectTimer = null;
    var fetching = false;
    var again = false;

    function refresh() {
      if (fetching) {
        again = true;
        return;
      }
      fetching = true;
      Promise.resolve()
        .then(function () {
          return deps.fetchFragment();
        })
        .then(function (html) {
          if (html && !stopped) deps.swap(html);
        })
        .catch(function () {
          /* offline or restarting: the next event or reconnect retries */
        })
        .then(function () {
          fetching = false;
          if (again && !stopped) {
            again = false;
            refresh();
          }
        });
    }

    function schedule() {
      if (refreshTimer !== null || stopped) return;
      refreshTimer = deps.setTimeout(function () {
        refreshTimer = null;
        refresh();
      }, Math.floor(deps.random() * REFRESH_JITTER_MS));
    }

    function open() {
      reconnectTimer = null;
      if (stopped) return;
      var current = deps.connect(deps.eventsUrl);
      source = current;
      current.addEventListener('hello', function () {
        attempt = 0;
        deps.setLive(true);
        if (connectedBefore) schedule();
        connectedBefore = true;
      });
      current.addEventListener('change', schedule);
      current.onerror = function () {
        deps.setLive(false);
        if (current.readyState === CLOSED && !stopped) {
          current.close();
          reconnectTimer = deps.setTimeout(open, backoffDelay(attempt++, deps.random));
        }
      };
    }

    function close() {
      stopped = true;
      if (refreshTimer !== null) deps.clearTimeout(refreshTimer);
      if (reconnectTimer !== null) deps.clearTimeout(reconnectTimer);
      refreshTimer = reconnectTimer = null;
      if (source) source.close();
    }

    return { open: open, close: close };
  }

  root.SiteCore = {
    dayKey: dayKey,
    formatTime: formatTime,
    formatShort: formatShort,
    dayLabel: dayLabel,
    groupDays: groupDays,
    backoffDelay: backoffDelay,
    createLive: createLive,
  };
})(typeof window !== 'undefined' ? window : globalThis);
