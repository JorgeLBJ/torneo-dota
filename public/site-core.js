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

  root.SiteCore = {
    dayKey: dayKey,
    formatTime: formatTime,
    formatShort: formatShort,
    dayLabel: dayLabel,
    groupDays: groupDays,
  };
})(typeof window !== 'undefined' ? window : globalThis);
