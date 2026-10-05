// Production dataset generator primitives. RFC 9636, POSIX TZ; no provider or Date dependency.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

// ---- POSIX TZ string ---------------------------------------------------------
// Seconds. POSIX sign is the opposite of a UTC offset.
const clockSeconds = (text, bound) => {
  const match = /^([+-]?)(\d{1,3})(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(text);
  assert(match, `Invalid POSIX clock: ${text}`);
  const [h, m, s] = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)];
  assert(h <= bound && m <= 59 && s <= 59, 'POSIX clock out of range');
  return (match[1] === '-' ? -1 : 1) * (h * 3600 + m * 60 + s);
};

// A transition rule: Jn | n | Mm.w.d, with an optional local time shift.
export function parseRule(text) {
  assert(text.split('/').length <= 2, 'Invalid POSIX rule suffix');
  const [date, time] = text.split('/');
  let rule;
  if (date.startsWith('M')) {
    const m = /^M(\d{1,2})\.(\d)\.(\d)$/.exec(date);
    assert(m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 5 && +m[3] >= 0 && +m[3] <= 6,
      `Invalid POSIX month rule: ${date}`);
    rule = { kind: 'M', month: +m[1], week: +m[2], weekday: +m[3] };
  } else if (date.startsWith('J')) {
    assert(/^J\d{1,3}$/.test(date) && +date.slice(1) >= 1 && +date.slice(1) <= 365, `Invalid POSIX Julian rule: ${date}`);
    rule = { kind: 'J', day: +date.slice(1) };
  } else {
    assert(/^\d{1,3}$/.test(date) && +date >= 0 && +date <= 365, `Invalid POSIX day rule: ${date}`);
    rule = { kind: 'D', day: +date };
  }
  rule.shift = time === undefined ? 7200 : clockSeconds(time, 167);
  return rule;
}

// STD offset [DST [offset] [,start[/time],end[/time]]]
export function parseFooter(footer) {
  const name = '(?:<[A-Za-z0-9+-]{3,}>|[A-Za-z]{3,})';
  const clock = '([+-]?\\d{1,3}(?::\\d{1,2}(?::\\d{1,2})?)?)';
  const match = new RegExp(`^${name}${clock}(?:(${name})${clock}?)?(,.*)?$`).exec(footer);
  assert(match, `Unsupported POSIX footer: ${footer}`);
  const std = -clockSeconds(match[1], 24) || 0;
  const labels = footer.match(new RegExp(`^(${name})${clock}(?:(${name}))?`));
  const specified = label => label !== '<-00>';
  if (!match[2]) { assert(!match[4], 'Rules require DST'); return { std, dst: null, stdSpecified: specified(labels[1]), dstSpecified: null, stdName: labels[1].replace(/[<>]/g,''), dstName: null, start: null, end: null }; }
  const dst = (match[3] ? -clockSeconds(match[3], 24) : std + 3600) || 0;
  const rules = match[4] === undefined ? null : match[4].slice(1).split(',');
  assert(rules && rules.length === 2, 'DST requires explicit future transition rules');
  return { std, dst, stdSpecified: specified(labels[1]), dstSpecified: specified(match[2]), stdName: labels[1].replace(/[<>]/g,''), dstName: match[2].replace(/[<>]/g,''), start: parseRule(rules[0]), end: parseRule(rules[1]) };
}
// ---- TZif --------------------------------------------------------------------
export function parseTzif(bytes) {
  const block = (at, size, expectedVersion) => {
    assert(at + 44 <= bytes.length, 'Truncated TZif header');
    assert.equal(bytes.toString('ascii', at, at + 4), 'TZif');
    const version = bytes[at + 4];
    assert([0, 50, 51, 52].includes(version), 'Unknown TZif version');
    if (expectedVersion !== undefined) assert.equal(version, expectedVersion);
    assert(bytes.subarray(at + 5, at + 20).every(value => value === 0), 'Reserved header bytes');
    const [ut, std, leap, times, count, chars] = Array.from({ length: 6 }, (_, i) => bytes.readUInt32BE(at + 20 + 4 * i));
    assert(count > 0 && count <= 256 && chars > 0);
    assert([0, count].includes(ut) && [0, count].includes(std));
    const types = at + 44 + times * (size + 1);
    const names = types + count * 6;
    const end = names + chars + leap * (size + 4) + std + ut;
    assert(end <= bytes.length, 'Truncated TZif block');
    let previous;
    for (let i = 0; i < times; i++) {
      const time = size === 8 ? bytes.readBigInt64BE(at + 44 + i * size) : BigInt(bytes.readInt32BE(at + 44 + i * size));
      assert(previous === undefined || time > previous, 'Unordered transitions');
      previous = time;
      assert(bytes[at + 44 + times * size + i] < count, 'Invalid transition type');
    }
    const localTypes = [];
    for (let i = 0; i < count; i++) {
      const offset = bytes.readInt32BE(types + i * 6);
      assert(offset >= -89999 && offset <= 93599, 'RFC TZif offset range');
      assert(bytes[types + i * 6 + 4] <= 1);
      const abbreviation = bytes[types + i * 6 + 5];
      assert(abbreviation < chars && bytes.subarray(names + abbreviation, names + chars).includes(0));
      let stop = abbreviation;
      while (bytes[names + stop] !== 0) stop++;
      localTypes.push({ offset, isDst: bytes[types + i * 6 + 4] === 1, abbreviation: bytes.toString('ascii', names + abbreviation, names + stop), specified: bytes.toString('ascii', names + abbreviation, names + stop) !== '-00' });
    }
    assert.equal(leap, 0, 'Leap-second TZif is outside SYSTEM Profile zones');
    assert(bytes.subarray(end - std - ut, end).every(value => value <= 1));
    for (let i=0;i<ut;i++) if(bytes[end-ut+i]) assert(std && bytes[end-ut-std+i], 'UT indicator requires standard indicator');
    return {
      end, version,
      transitions: Array.from({ length: times }, (_, i) => ({
        utc: (() => { const n = Number(size === 8 ? bytes.readBigInt64BE(at + 44 + i * size) : BigInt(bytes.readInt32BE(at + 44 + i * size))); assert(Number.isSafeInteger(n), 'Transition exceeds exact integer range'); return n; })(),
        type: bytes[at + 44 + times * size + i],
      })),
      localTypes,
    };
  };
  let parsed = block(0, 4);
  let footer = null;
  if (parsed.version !== 0) {
    parsed = block(parsed.end, 8, parsed.version);
    const tail = bytes.subarray(parsed.end);
    assert(tail.length >= 2 && tail[0] === 10 && tail.at(-1) === 10 && tail.subarray(1, -1).every(value => value >= 32 && value <= 126), 'Invalid TZif footer');
    const text = tail.toString('ascii', 1, tail.length - 1);
    footer = text ? parseFooter(text) : null;
    if (footer && parsed.version === 50) for (const r of [footer.start, footer.end].filter(Boolean)) assert(r.shift >= 0 && r.shift <= 89999, 'Extended transition time requires TZif v3+');
  } else assert.equal(parsed.end, bytes.length, 'Unexpected TZif v1 tail');

  return { transitions: parsed.transitions, localTypes: parsed.localTypes, initial: parsed.localTypes[0], footer };
}
// ---- Integer proleptic Gregorian calendar (no Date, no platform tz data) ----
export const isLeap = year => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
export const daysInMonth = (year, month) => (month === 2
  ? (isLeap(year) ? 29 : 28)
  : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]);

// Days since 1970-01-01 (Howard Hinnant's civil_from_days inverse).
export function daysFromCivil(year, month, day) {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
export function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}
export const yearOfDays = days => civilFromDays(days).year;
export const dayOfWeek = days => ((days % 7) + 11) % 7; // 1970-01-01 was a Thursday

// Local (wall-clock) epoch seconds of a POSIX transition rule in a given year.
export function ruleLocalSeconds(rule, year) {
  let days;
  if (rule.kind === 'J') {
    days = daysFromCivil(year, 1, 1) + rule.day - 1 + (isLeap(year) && rule.day >= 60 ? 1 : 0);
  } else if (rule.kind === 'D') {
    days = daysFromCivil(year, 1, 1) + rule.day;
  } else {
    const first = daysFromCivil(year, rule.month, 1);
    const firstWeekday = dayOfWeek(first);
    // The weekday of week w, where week 1 is the week containing day 1.
    let offset = (rule.weekday - firstWeekday + 7) % 7 + (rule.week - 1) * 7;
    const length = daysInMonth(year, rule.month);
    while (offset + 1 > length) offset -= 7;
    days = first + offset;
  }
  return days * 86400 + rule.shift;
}

