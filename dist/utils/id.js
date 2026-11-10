"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newId = newId;
exports.shortId = shortId;
exports.isSnowflake = isSnowflake;
const crypto_1 = require("crypto");
/**
 * Collision-resistant identifier helper.
 *
 * The old code used `Date.now()` + `Math.random().toString(36)`, which can
 * collide when two records are written in the same millisecond and is not
 * sortable by insertion order. `randomUUID()` gives us a stable, unique id
 * while the optional prefix keeps ids readable in logs and the dashboard.
 */
function newId(prefix) {
    const raw = (0, crypto_1.randomUUID)().replace(/-/g, '');
    return prefix ? `${prefix}_${raw}` : raw;
}
/** Short id for user-facing references (still collision-resistant enough for tickets). */
function shortId(prefix) {
    const raw = (0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 8);
    return prefix ? `${prefix}_${raw}` : raw;
}
/** Discord snowflake-ish check used when accepting ids from the dashboard. */
function isSnowflake(value) {
    return typeof value === 'string' && /^\d{15,25}$/.test(value);
}
