const assert = require('node:assert/strict');
const { normalizeCompany } = require('../packages/shared/dist');

assert.equal(normalizeCompany('Google'), 'google');
assert.equal(normalizeCompany('Google LLC'), 'google');
assert.equal(normalizeCompany('GOOGLE, Inc.'), 'google');
assert.equal(normalizeCompany('Microsoft Corporation'), 'microsoft');
assert.equal(normalizeCompany('  Acme Corp  '), 'acme');
assert.equal(normalizeCompany('Apple Ltd.'), 'apple');
assert.equal(normalizeCompany('Google') + '-profile1', normalizeCompany('Google LLC') + '-profile1');
console.log('All unit tests passed (7 assertions)');
