const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('Tailwind configuration only exports configuration and has no appended execution', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/tailwind.config.js'), 'utf8');
  const parsed = ts.createSourceFile('tailwind.config.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(parsed.statements.length, 1, 'Unexpected executable statements in build configuration');
  const statement = parsed.statements[0];
  assert.ok(ts.isExpressionStatement(statement));
  assert.ok(ts.isBinaryExpression(statement.expression));
  assert.equal(statement.expression.left.getText(parsed), 'module.exports');
  assert.ok(ts.isObjectLiteralExpression(statement.expression.right));
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  assert.ok(sandbox.module.exports.content.includes('./src/**/*.{js,ts,jsx,tsx,mdx}'));
  assert.equal(sandbox.module.exports.plugins.length, 0);
});
